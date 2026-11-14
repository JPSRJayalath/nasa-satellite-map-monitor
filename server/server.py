
from calendar import monthrange
from datetime import date
from io import StringIO
from pathlib import Path
from threading import Event
from typing import Optional
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
import asyncio

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DATASET_DIRECTORY = Path(__file__).resolve().parent / "datasets"
MAX_LOCATION_RECORDS = 50_000
MAX_MERCATOR_LATITUDE = 85.05112878
CATEGORICAL_COLUMNS = (
    "acq_date",
    "acq_time",
    "satellite",
    "instrument",
    "confidence",
    "version",
    "daynight",
    "type",
    "dataset_name",
    "sensor_family",
)

connections: list[WebSocket] = []

# Cached dataset
fire_df: Optional[pd.DataFrame] = None
location_fire_df: Optional[pd.DataFrame] = None
file_modified: Optional[tuple[tuple[str, int, int], ...]] = None


# ---------------------------------
# 1. LOAD AND CACHE CSV
# ---------------------------------

def discover_dataset_files() -> tuple[Path, ...]:
    if not DATASET_DIRECTORY.is_dir():
        raise FileNotFoundError(
            f"Fire dataset directory does not exist: {DATASET_DIRECTORY}"
        )

    return tuple(
        sorted(
            DATASET_DIRECTORY.glob("*.csv"),
            key=lambda path: path.name.casefold(),
        )
    )


def infer_sensor_family(
    df: pd.DataFrame,
    original_columns: set[str],
) -> pd.Series:
    fallback = (
        "VIIRS"
        if "bright_ti4" in original_columns or "bright_ti5" in original_columns
        else "MODIS"
    )
    family = pd.Series(fallback, index=df.index, dtype="object")

    instrument = (
        df["instrument"].fillna("").astype(str).str.strip().str.upper()
        if "instrument" in df.columns
        else pd.Series("", index=df.index)
    )
    satellite = (
        df["satellite"].fillna("").astype(str).str.strip().str.upper()
        if "satellite" in df.columns
        else pd.Series("", index=df.index)
    )

    explicit_modis = instrument.str.contains("MODIS", regex=False)
    explicit_viirs = instrument.str.contains(r"VIIRS|SNPP|NPP", regex=True)
    family.loc[explicit_modis] = "MODIS"
    family.loc[explicit_viirs] = "VIIRS"

    unknown_instrument = ~(explicit_modis | explicit_viirs)
    modis_satellite = satellite.isin({"A", "TERRA", "AQUA"})
    viirs_satellite = satellite.str.contains(
        r"VIIRS|SNPP|NPP|N20|N21|NOAA[- ]?20|NOAA[- ]?21",
        regex=True,
    )
    family.loc[unknown_instrument & modis_satellite] = "MODIS"
    family.loc[unknown_instrument & viirs_satellite] = "VIIRS"

    return family


def normalize_dataset(df: pd.DataFrame, dataset_name: str) -> pd.DataFrame:
    df.columns = [str(column).strip().lower() for column in df.columns]
    original_columns = set(df.columns)

    if "bright_ti4" not in df.columns and "brightness" in df.columns:
        df["bright_ti4"] = df["brightness"]

    if "bright_ti5" not in df.columns and "bright_t31" in df.columns:
        df["bright_ti5"] = df["bright_t31"]

    required = {
        "latitude",
        "longitude",
        "acq_date",
        "acq_time",
        "frp",
        "bright_ti4",
        "bright_ti5",
    }
    missing = sorted(required.difference(df.columns))
    if missing:
        raise ValueError(
            f"{dataset_name} is missing required fire-data columns: "
            f"{', '.join(missing)}"
        )

    for column in ("satellite", "instrument", "confidence", "daynight"):
        if column not in df.columns:
            df[column] = "Unknown"
        else:
            df[column] = df[column].fillna("Unknown")

    df["dataset_name"] = dataset_name
    df["sensor_family"] = infer_sensor_family(df, original_columns)

    numeric_columns = [
        "latitude",
        "longitude",
        "brightness",
        "bright_t31",
        "bright_ti4",
        "bright_ti5",
        "frp",
        "scan",
        "track"
    ]

    for col in numeric_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "confidence" in df.columns:
        raw_confidence = df["confidence"].astype(str).str.strip()
        confidence_values = pd.to_numeric(raw_confidence, errors="coerce")
        numeric_confidence = confidence_values.notna()
        confidence_labels = raw_confidence.str.lower().replace({
            "n": "nominal",
            "h": "high",
            "l": "low",
        })

        if numeric_confidence.any():
            df["confidence_value"] = confidence_values
            confidence_labels.loc[numeric_confidence] = (
                confidence_values.loc[numeric_confidence].map(
                    lambda value: "low" if value < 30 else
                    "nominal" if value < 80 else "high"
                )
            )

        df["confidence"] = confidence_labels

    for column in CATEGORICAL_COLUMNS:
        if column in df.columns:
            df[column] = df[column].astype("string").astype("category")

    return df


def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    required = [
        "latitude",
        "longitude",
        "acq_date",
        "acq_time",
        "bright_ti4",
        "bright_ti5",
        "frp",
    ]

    return df.dropna(subset=required)


def sample_location_data(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) <= MAX_LOCATION_RECORDS:
        return df

    if "dataset_name" not in df.columns:
        return df.sample(n=MAX_LOCATION_RECORDS, random_state=42)

    dataset_counts = df.groupby(
        "dataset_name",
        observed=True,
        sort=True,
    ).size()
    if len(dataset_counts) > MAX_LOCATION_RECORDS:
        return df.sample(n=MAX_LOCATION_RECORDS, random_state=42)

    quotas = dataset_counts * (MAX_LOCATION_RECORDS / len(df))
    allocations = {
        dataset: max(1, int(quota))
        for dataset, quota in quotas.items()
    }

    while sum(allocations.values()) > MAX_LOCATION_RECORDS:
        candidates = [
            dataset
            for dataset, count in allocations.items()
            if count > 1
        ]
        dataset = max(
            candidates,
            key=lambda name: allocations[name] - quotas[name],
        )
        allocations[dataset] -= 1

    while sum(allocations.values()) < MAX_LOCATION_RECORDS:
        candidates = [
            dataset
            for dataset, count in allocations.items()
            if count < dataset_counts[dataset]
        ]
        if not candidates:
            break
        dataset = max(
            candidates,
            key=lambda name: quotas[name] - allocations[name],
        )
        allocations[dataset] += 1

    samples = [
        dataset_df.sample(n=allocations[name], random_state=42)
        for name, dataset_df in df.groupby(
            "dataset_name",
            observed=True,
            sort=True,
        )
    ]
    return pd.concat(samples, ignore_index=True, sort=False)


def add_map_columns(df: pd.DataFrame) -> pd.DataFrame:
    latitude = df["latitude"].to_numpy(dtype=np.float64)
    longitude = df["longitude"].to_numpy(dtype=np.float64)
    clipped_latitude = np.clip(
        latitude,
        -MAX_MERCATOR_LATITUDE,
        MAX_MERCATOR_LATITUDE,
    )
    df["_map_x"] = (longitude + 180) / 360
    df["_map_y"] = (
        1 - np.arcsinh(np.tan(np.radians(clipped_latitude))) / np.pi
    ) / 2

    frp = np.maximum(df["frp"].to_numpy(dtype=np.float64), 0)
    bright_ti4 = df["bright_ti4"].to_numpy(dtype=np.float64)
    confidence = (
        df["confidence"]
        .map({"high": 100, "nominal": 70, "low": 30})
        .fillna(0)
        .to_numpy(dtype=np.float64)
    )
    risk_score = (
        np.clip(np.log1p(frp) / np.log1p(100) * 100, 0, 100) * 0.40
        + confidence * 0.35
        + np.clip((bright_ti4 - 250) / 150 * 100, 0, 100) * 0.25
    )
    risk_codes = np.select(
        [risk_score >= 80, risk_score >= 60, risk_score >= 40, risk_score >= 20],
        [0, 1, 2, 3],
        default=4,
    ).astype(np.int8)
    df["_risk_level"] = pd.Categorical.from_codes(
        risk_codes,
        categories=["Critical", "High", "Moderate", "Low", "Very Low"],
    )

    date_categories = df["acq_date"].cat.categories
    date_values = pd.to_datetime(
        date_categories,
        format="%Y-%m-%d",
        errors="coerce",
    )
    date_keys_by_category = np.asarray(
        [
            int(value.strftime("%Y%m%d")) if not pd.isna(value) else -1
            for value in date_values
        ],
        dtype=np.int32,
    )
    month_keys_by_category = np.where(
        date_keys_by_category > 0,
        (date_keys_by_category // 10000) * 12
        + ((date_keys_by_category // 100) % 100)
        - 1,
        -1,
    ).astype(np.int32)
    date_codes = df["acq_date"].cat.codes.to_numpy()
    valid_date_codes = date_codes >= 0
    safe_date_codes = np.maximum(date_codes, 0)
    df["_date_key"] = np.where(
        valid_date_codes,
        date_keys_by_category[safe_date_codes],
        -1,
    ).astype(np.int32)
    df["_year_month_key"] = np.where(
        valid_date_codes,
        month_keys_by_category[safe_date_codes],
        -1,
    ).astype(np.int32)
    df["_year"] = (
        df["acq_date"]
        .map({
            category: str(category)[:4]
            for category in date_categories
        })
        .astype("category")
    )
    return df


def _latitude_to_map_y(latitude: float) -> float:
    clipped_latitude = np.clip(
        latitude,
        -MAX_MERCATOR_LATITUDE,
        MAX_MERCATOR_LATITUDE,
    )
    return float(
        (1 - np.arcsinh(np.tan(np.radians(clipped_latitude))) / np.pi) / 2
    )


def map_geojson(
    df: pd.DataFrame,
    west: float,
    south: float,
    east: float,
    north: float,
    year: Optional[str],
    sensors: Optional[str],
    risk: Optional[str],
    cancel_event: Optional[Event] = None,
) -> dict:
    if not np.isfinite([west, south, east, north]).all():
        raise HTTPException(status_code=422, detail="Map bounds must be finite numbers.")

    west = float(np.clip(west, -180, 180))
    east = float(np.clip(east, -180, 180))
    south = float(np.clip(south, -90, 90))
    north = float(np.clip(north, -90, 90))
    if south > north:
        south, north = north, south

    west_x = (west + 180) / 360
    east_x = (east + 180) / 360
    north_y = _latitude_to_map_y(north)
    south_y = _latitude_to_map_y(south)
    min_y, max_y = sorted((north_y, south_y))

    longitude_values = df["longitude"].to_numpy(dtype=np.float64, copy=False)
    latitude_values = df["latitude"].to_numpy(dtype=np.float64, copy=False)
    map_x = df["_map_x"].to_numpy(dtype=np.float64, copy=False)
    map_y = df["_map_y"].to_numpy(dtype=np.float64, copy=False)
    mask = (
        (longitude_values >= -180)
        & (longitude_values <= 180)
        & (latitude_values >= -90)
        & (latitude_values <= 90)
    )
    if west_x <= east_x:
        mask &= (map_x >= west_x) & (map_x <= east_x)
    else:
        mask &= (map_x >= west_x) | (map_x <= east_x)
    mask &= (map_y >= min_y) & (map_y <= max_y)
    if year is not None:
        if len(year) != 4 or not year.isdigit():
            raise HTTPException(status_code=422, detail="Year must contain four digits.")
        year_categories = df["_year"].cat.categories
        if year not in year_categories:
            return {"type": "FeatureCollection", "features": []}
        mask &= df["_year"].cat.codes.to_numpy() == year_categories.get_loc(year)

    if sensors is not None:
        sensor_families = {
            family.strip().upper()
            for family in sensors.split(",")
            if family.strip()
        }
        categories = df["sensor_family"].cat.categories
        sensor_codes = [
            categories.get_loc(family)
            for family in sensor_families
            if family in categories
        ]
        if sensor_families.difference(categories):
            raise HTTPException(
                status_code=422,
                detail="Sensors must be MODIS or VIIRS.",
            )
        mask &= np.isin(df["sensor_family"].cat.codes.to_numpy(), sensor_codes)

    if risk is not None:
        risk_levels = {
            "critical": "Critical",
            "high": "High",
            "moderate": "Moderate",
            "low": "Low",
            "very low": "Very Low",
        }
        level = risk_levels.get(risk.strip().lower())
        if level is None:
            raise HTTPException(status_code=422, detail="Unknown fire-risk filter.")
        categories = df["_risk_level"].cat.categories
        mask &= (
            df["_risk_level"].cat.codes.to_numpy()
            == categories.get_loc(level)
        )

    visible_indices = np.flatnonzero(mask)
    if len(visible_indices) == 0:
        return {"type": "FeatureCollection", "features": []}

    sensor_categories = df["sensor_family"].cat.categories
    sensor_codes = df["sensor_family"].cat.codes.to_numpy()
    features = []
    for index, source_index in enumerate(visible_indices):
        if index % 4096 == 0 and cancel_event is not None and cancel_event.is_set():
            return {"type": "FeatureCollection", "features": []}

        family = sensor_categories[sensor_codes[source_index]]
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    float(longitude_values[source_index]),
                    float(latitude_values[source_index]),
                ],
            },
            "properties": {
                "fireId": int(source_index),
                "sensorFamily": str(family),
            },
        })

    return {"type": "FeatureCollection", "features": features}


def available_years(df: pd.DataFrame) -> list[str]:
    years = {
        str(acq_date)[:4]
        for acq_date in df["acq_date"].dropna().unique()
    }

    return sorted(
        (year for year in years if len(year) == 4 and year.isdigit()),
        reverse=True,
    )


def align_dataset_categories(datasets: list[pd.DataFrame]) -> None:
    for column in CATEGORICAL_COLUMNS:
        categories = pd.Index([
            value
            for dataset in datasets
            if column in dataset.columns
            for value in dataset[column].cat.categories
        ]).unique()
        category_type = pd.CategoricalDtype(categories=categories)

        for dataset in datasets:
            if column in dataset.columns:
                dataset[column] = dataset[column].astype(category_type)


def read_csv() -> pd.DataFrame:

    global fire_df, location_fire_df, file_modified

    csv_files = discover_dataset_files()
    if not csv_files:
        raise FileNotFoundError(
            f"No fire-monitoring CSV files found in {DATASET_DIRECTORY}"
        )

    modified = tuple(
        (str(csv_file), csv_file.stat().st_mtime_ns, csv_file.stat().st_size)
        for csv_file in csv_files
    )

    if fire_df is None or modified != file_modified:

        print(f"Loading {len(csv_files)} fire datasets...")

        datasets = [
            normalize_dataset(
                pd.read_csv(csv_file, low_memory=False, encoding="utf-8-sig"),
                csv_file.name,
            )
            for csv_file in csv_files
        ]
        align_dataset_categories(datasets)
        df = add_map_columns(
            clean_data(pd.concat(datasets, ignore_index=True, sort=False))
        )

        fire_df = df
        location_fire_df = sample_location_data(df)
        file_modified = modified

        print(
            f"Loaded {len(df):,} valid fire records from "
            f"{len(csv_files)} datasets; location list sample: "
            f"{len(location_fire_df):,}"
        )

    return fire_df


# ---------------------------------
# 2. FIRE STATISTICS
# ---------------------------------

def calculate_summary(df):

    return {
        "total_fires": int(len(df)),
        "total_frp": round(float(df["frp"].sum()), 2),
        "average_frp": round(float(df["frp"].mean()), 2),
        "maximum_frp": round(float(df["frp"].max()), 2),
        "minimum_frp": round(float(df["frp"].min()), 2),
        "average_ti4": round(float(df["bright_ti4"].mean()), 2),
        "average_ti5": round(float(df["bright_ti5"].mean()), 2),
    }


def calculate_brightness_distribution(df):

    distribution = []

    for (dataset_name, sensor_family), source_df in df.groupby(
        ["dataset_name", "sensor_family"],
        observed=True,
    ):
        is_modis = sensor_family == "MODIS"
        distribution.append({
            "dataset": dataset_name,
            "sensor_family": sensor_family,
            "channel_1_name": "Brightness" if is_modis else "Brightness TI4",
            "channel_1_average": round(float(source_df["bright_ti4"].mean()), 2),
            "channel_2_name": "Brightness T31" if is_modis else "Brightness TI5",
            "channel_2_average": round(float(source_df["bright_ti5"].mean()), 2),
        })

    return distribution


# ---------------------------------
# 4. FRP DISTRIBUTION
# ---------------------------------

def calculate_frp(df):

    result = (
        df.groupby("acq_date", dropna=True, observed=True)
        .agg(
            total_frp=("frp", "sum"),
            average_frp=("frp", "mean"),
            fire_count=("frp", "count")
        )
        .reset_index()
    )

    result["date"] = result["acq_date"].astype(str)

    return result[
        ["date", "total_frp", "average_frp", "fire_count"]
    ].sort_values("date").to_dict("records")


# ---------------------------------
# 5. TEMPERATURE ANALYSIS
# ---------------------------------

def calculate_temperature(df):

    return [
        {
            "name": "Bright TI4",
            "value": round(float(df["bright_ti4"].mean()), 2)
        },
        {
            "name": "Bright TI5",
            "value": round(float(df["bright_ti5"].mean()), 2)
        }
    ]


# ---------------------------------
# 6. SATELLITE DISTRIBUTION
# ---------------------------------

def calculate_satellites(df):

    result = (
        df.groupby("satellite", observed=True)
        .size()
        .reset_index(name="count")
        .rename(columns={"satellite": "name"})
    )

    return result.to_dict("records")


# ---------------------------------
# 7. SOURCE DATASET DISTRIBUTION
# ---------------------------------

def calculate_source_distribution(df):

    result = (
        df.groupby(["dataset_name", "sensor_family"], observed=True)
        .agg(
            fire_count=("frp", "count"),
            total_frp=("frp", "sum")
        )
        .reset_index()
    )

    result = result.rename(columns={"dataset_name": "dataset"})
    return result[
        ["dataset", "sensor_family", "fire_count", "total_frp"]
    ].to_dict("records")


# ---------------------------------
# 8. CONFIDENCE DISTRIBUTION
# ---------------------------------

def calculate_confidence(df):

    result = (
        df.groupby("confidence", observed=True)
        .size()
        .reset_index(name="count")
        .rename(columns={"confidence": "name"})
    )

    return result.to_dict("records")


# ---------------------------------
# 9. DAY / NIGHT DISTRIBUTION
# ---------------------------------

def calculate_daynight(df):

    result = (
        df.groupby("daynight", observed=True)
        .size()
        .reset_index(name="count")
        .rename(columns={"daynight": "name"})
    )

    return result.to_dict("records")


# ---------------------------------
# 10. HOURLY DISTRIBUTION
# ---------------------------------

def calculate_hourly(df):

    hours = df["acq_time"].astype(str).str.zfill(4)
    hours = pd.to_numeric(hours.str[:2], errors="coerce")

    result = (
        hours.value_counts()
        .rename_axis("hour")
        .reset_index(name="fire_count")
        .sort_values("hour")
    )

    return result.to_dict("records")


# ---------------------------------
# 11. GEOGRAPHIC HOTSPOTS
# ---------------------------------

def calculate_hotspots(df):

    grid_df = df[["latitude", "longitude", "frp"]].copy()
    grid_df["lat_grid"] = grid_df["latitude"].round(1)
    grid_df["lon_grid"] = grid_df["longitude"].round(1)

    result = (
        grid_df.groupby(["lat_grid", "lon_grid"], observed=True)
        .agg(
            fire_count=("frp", "count"),
            total_frp=("frp", "sum")
        )
        .reset_index()
    )

    return result.to_dict("records")


# ---------------------------------
# 12. COMPLETE ANALYTICS
# ---------------------------------

def analyze_fire_data():

    df = read_csv()

    return {
        "summary": calculate_summary(df),
        "brightness_distribution": calculate_brightness_distribution(df),
        "frp_distribution": calculate_frp(df),
        "temperature": calculate_temperature(df),
        "satellite_distribution": calculate_satellites(df),
        "source_distribution": calculate_source_distribution(df),
        "confidence_distribution": calculate_confidence(df),
        "daynight_distribution": calculate_daynight(df),
        "hourly_distribution": calculate_hourly(df),
        "geographic_distribution": calculate_hotspots(df)
    }


def validate_fire_filters(
    start_date: Optional[date],
    end_date: Optional[date],
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
) -> None:
    if start_date is not None and end_date is not None and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="Start date must be on or before end date.",
        )

    bounds = (west, south, east, north)
    if any(value is not None for value in bounds) and not all(
        value is not None for value in bounds
    ):
        raise HTTPException(
            status_code=422,
            detail="Provide all four geographic bounds or leave them all empty.",
        )

    if all(value is not None for value in bounds):
        bound_values = np.asarray(bounds, dtype=np.float64)
        if not np.isfinite(bound_values).all():
            raise HTTPException(
                status_code=422,
                detail="Geographic bounds must be finite numbers.",
            )
        if not (-180 <= west < east <= 180):
            raise HTTPException(
                status_code=422,
                detail="Longitude bounds must satisfy -180 <= west < east <= 180.",
            )
        if not (-90 <= south < north <= 90):
            raise HTTPException(
                status_code=422,
                detail="Latitude bounds must satisfy -90 <= south < north <= 90.",
            )


def date_from_key(date_key: int) -> date:
    return date(
            date_key // 10000,
            (date_key // 100) % 100,
            date_key % 100,
    )


def spatial_fire_mask(
    df: pd.DataFrame,
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
) -> np.ndarray:
    mask = np.ones(len(df), dtype=bool)
    if west is None or south is None or east is None or north is None:
        return mask

    longitude = df["longitude"].to_numpy(dtype=np.float64, copy=False)
    latitude = df["latitude"].to_numpy(dtype=np.float64, copy=False)
    mask &= (longitude >= west) & (longitude <= east)
    mask &= (latitude >= south) & (latitude <= north)
    return mask


def fire_record_mask(
    df: pd.DataFrame,
    start_date: Optional[date],
    end_date: Optional[date],
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
) -> np.ndarray:
    validate_fire_filters(start_date, end_date, west, south, east, north)
    mask = spatial_fire_mask(df, west, south, east, north)
    date_keys = df["_date_key"].to_numpy(dtype=np.int32, copy=False)
    mask &= date_keys > 0

    if start_date is not None:
        mask &= date_keys >= int(start_date.strftime("%Y%m%d"))
    if end_date is not None:
        mask &= date_keys <= int(end_date.strftime("%Y%m%d"))

    return mask


def count_month_keys(df: pd.DataFrame, mask: np.ndarray) -> np.ndarray:
    month_keys = df["_year_month_key"].to_numpy(
        dtype=np.int32,
        copy=False,
    )
    maximum_key = int(month_keys.max(initial=-1))
    counts = np.zeros(maximum_key + 1, dtype=np.int64)
    chunk_size = 500_000

    for offset in range(0, len(df), chunk_size):
        stop = min(offset + chunk_size, len(df))
        selected_keys = month_keys[offset:stop][mask[offset:stop]]
        selected_keys = selected_keys[selected_keys >= 0]
        if selected_keys.size:
            counts += np.bincount(selected_keys, minlength=len(counts))

    return counts


def fire_calendar_data(
    df: pd.DataFrame,
    start_date: Optional[date],
    end_date: Optional[date],
    west: Optional[float],
    south: Optional[float],
    east: Optional[float],
    north: Optional[float],
) -> dict:
    validate_fire_filters(start_date, end_date, west, south, east, north)

    date_keys = df["_date_key"].to_numpy(dtype=np.int32, copy=False)
    valid_date_keys = date_keys[date_keys > 0]
    if valid_date_keys.size == 0:
        return {
            "available_start_date": None,
            "available_end_date": None,
            "total_detections": 0,
            "calendar": [],
        }

    available_start = date_from_key(int(valid_date_keys.min()))
    available_end = date_from_key(int(valid_date_keys.max()))
    resolved_start = start_date or available_start
    resolved_end = end_date or available_end
    if resolved_start > resolved_end:
        raise HTTPException(
            status_code=422,
            detail="Start date must be on or before end date.",
        )
    if resolved_end.year - resolved_start.year > 100:
        raise HTTPException(
            status_code=422,
            detail="Calendar date range cannot exceed 100 years.",
        )

    spatial_mask = spatial_fire_mask(df, west, south, east, north)
    selected_mask = spatial_mask & (date_keys > 0)
    selected_mask &= date_keys >= int(resolved_start.strftime("%Y%m%d"))
    selected_mask &= date_keys <= int(resolved_end.strftime("%Y%m%d"))

    historical_mask = spatial_mask & (date_keys > 0)
    historical_mask &= date_keys <= int(resolved_end.strftime("%Y%m%d"))
    selected_counts = count_month_keys(df, selected_mask)
    historical_counts = count_month_keys(df, historical_mask)

    calendar = []
    first_year = resolved_start.year
    last_year = resolved_end.year
    earliest_data_year = available_start.year

    for year in range(first_year, last_year + 1):
        for month in range(1, 13):
            month_start = date(year, month, 1)
            month_end = date(year, month, monthrange(year, month)[1])
            in_range = month_end >= resolved_start and month_start <= resolved_end
            complete_month = (
                in_range
                and resolved_start <= month_start
                and resolved_end >= month_end
                and available_start <= month_start
                and available_end >= month_end
            )

            month_key = year * 12 + month - 1
            fire_count = (
                int(selected_counts[month_key])
                if in_range and month_key < len(selected_counts)
                else None
            )
            previous_counts = [
                int(historical_counts[previous_year * 12 + month - 1])
                if previous_year * 12 + month - 1 < len(historical_counts)
                else 0
                for previous_year in range(earliest_data_year, year)
                if available_start <= date(previous_year, month, 1)
                and available_end >= date(
                    previous_year,
                    month,
                    monthrange(previous_year, month)[1],
                )
            ]
            historical_median = (
                float(np.median(previous_counts))
                if previous_counts
                else None
            )
            anomaly = (
                round(fire_count - historical_median, 2)
                if complete_month
                and fire_count is not None
                and historical_median is not None
                else None
            )

            calendar.append({
                "year": year,
                "month": month,
                "fire_count": fire_count,
                "historical_median": historical_median,
                "anomaly": anomaly,
                "in_range": in_range,
                "complete_month": complete_month,
            })

    return {
        "available_start_date": available_start.isoformat(),
        "available_end_date": available_end.isoformat(),
        "start_date": resolved_start.isoformat(),
        "end_date": resolved_end.isoformat(),
        "total_detections": int(np.count_nonzero(selected_mask)),
        "calendar": calendar,
    }


def stream_fire_csv(df: pd.DataFrame, mask: np.ndarray):
    public_columns = [
        column for column in df.columns if not column.startswith("_")
    ]
    buffer = StringIO()
    df.iloc[:0].loc[:, public_columns].to_csv(buffer, index=False)
    yield buffer.getvalue()

    chunk_size = 50_000
    for offset in range(0, len(df), chunk_size):
        stop = min(offset + chunk_size, len(df))
        chunk_mask = mask[offset:stop]
        if not chunk_mask.any():
            continue

        buffer.seek(0)
        buffer.truncate(0)
        df.iloc[offset:stop].iloc[chunk_mask].loc[:, public_columns].to_csv(
            buffer,
            index=False,
            header=False,
        )
        yield buffer.getvalue()


# ---------------------------------
# 12. ROOT ENDPOINT
# ---------------------------------

@app.get("/")
async def root():

    return {
        "status": "Fire Monitoring Server Online"
    }


# ---------------------------------
# 13. ANALYTICS REST API
# ---------------------------------

@app.get("/api/fire/analytics")
async def fire_analytics():

    result = await asyncio.to_thread(
        analyze_fire_data
    )

    return {
        "success": True,
        "analytics": result
    }


@app.get("/api/fire/calendar")
async def fire_calendar(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    west: Optional[float] = None,
    south: Optional[float] = None,
    east: Optional[float] = None,
    north: Optional[float] = None,
):
    df = await asyncio.to_thread(read_csv)
    result = await asyncio.to_thread(
        fire_calendar_data,
        df,
        start_date,
        end_date,
        west,
        south,
        east,
        north,
    )
    return {"success": True, **result}


@app.get("/api/fire/export.csv")
async def fire_export_csv(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    west: Optional[float] = None,
    south: Optional[float] = None,
    east: Optional[float] = None,
    north: Optional[float] = None,
):
    df = await asyncio.to_thread(read_csv)
    mask = await asyncio.to_thread(
        fire_record_mask,
        df,
        start_date,
        end_date,
        west,
        south,
        east,
        north,
    )
    return StreamingResponse(
        stream_fire_csv(df, mask),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="fire-detections.csv"'
        },
    )


# ---------------------------------
# 14. MAP VIEWPORT DATA API
# ---------------------------------

@app.get("/api/fire/map")
async def fire_map(
    request: Request,
    west: float,
    south: float,
    east: float,
    north: float,
    year: Optional[str] = None,
    sensors: Optional[str] = None,
    risk: Optional[str] = None,
):
    df = await asyncio.to_thread(read_csv)
    cancel_event = Event()
    map_task = asyncio.create_task(asyncio.to_thread(
        map_geojson,
        df,
        west,
        south,
        east,
        north,
        year,
        sensors,
        risk,
        cancel_event,
    ))
    while not map_task.done():
        if await request.is_disconnected():
            cancel_event.set()
            await map_task
            return Response(status_code=499)
        await asyncio.sleep(0.1)

    return await map_task


# ---------------------------------
# 15. PAGINATED RAW DATA API
# ---------------------------------

@app.get("/api/fire/data")
async def fire_data(
    offset: int = 0,
    limit: int = 1000
):

    limit = max(1, min(limit, 5000))

    df = await asyncio.to_thread(read_csv)

    public_columns = [
        column for column in df.columns if not column.startswith("_")
    ]
    records = df.loc[:, public_columns].iloc[offset:offset + limit]

    # Convert NaN values to JSON null
    records = records.astype(object).where(
        pd.notna(records), None
    )

    return {
        "count": len(df),
        "offset": offset,
        "limit": limit,
        "data": records.to_dict("records")
    }


# ---------------------------------
# 16. WEBSOCKET
# ---------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):

    await websocket.accept()
    connections.append(websocket)

    print("Client Connected")

    try:

        while True:

            message = await websocket.receive_json()

            if message.get("app") != "NASA Fire Monitor":
                continue

            if message.get("permission") != "read":
                await websocket.send_json({
                    "type": "error",
                    "decline": "Permission Denied"
                })
                continue

            category = message.get("category", "analytics")

            # Send analytics only
            if category == "analytics":

                analytics = await asyncio.to_thread(
                    analyze_fire_data
                )

                await websocket.send_json({
                    "type": "analytics_update",
                    "data": analytics
                })

            # Location list request: analytics + a representative raw-data sample
            elif category == "any":

                analytics = await asyncio.to_thread(
                    analyze_fire_data
                )

                df = await asyncio.to_thread(read_csv)

                location_df = (
                    location_fire_df
                    if location_fire_df is not None
                    else sample_location_data(df)
                )
                public_columns = [
                    column
                    for column in location_df.columns
                    if not column.startswith("_")
                ]
                records = location_df.loc[:, public_columns].astype(object).where(
                    pd.notna(location_df.loc[:, public_columns]), None
                )

                await websocket.send_json({
                    "type": "analytics_update",
                    "data": analytics
                })

                await websocket.send_json({
                    "type": "initial_data",
                    "count": len(df),
                    "returned": len(records),
                    "sampled": len(records) < len(df),
                    "years": available_years(df),
                    "data": records.to_dict("records")
                })

    except WebSocketDisconnect:

        print("Client Disconnected")

    finally:

        if websocket in connections:
            connections.remove(websocket)
