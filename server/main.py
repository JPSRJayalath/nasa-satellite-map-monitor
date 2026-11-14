
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import pandas as pd
import numpy as np
import asyncio

app = FastAPI()

CSV_FILES = (
    Path(__file__).resolve().parent / "datasets" / "dataset_01.csv",
    Path(__file__).resolve().parent / "datasets" / "dataset_02.csv",
)

connections: list[WebSocket] = []

# Cached dataset
fire_df: Optional[pd.DataFrame] = None
file_modified: Optional[tuple[float, ...]] = None


# ---------------------------------
# 1. LOAD AND CACHE CSV
# ---------------------------------

def normalize_dataset(df: pd.DataFrame) -> pd.DataFrame:
    df["sensor_family"] = (
        "MODIS"
        if "brightness" in df.columns and "bright_t31" in df.columns
        else "VIIRS"
    )

    if "bright_ti4" not in df.columns and "brightness" in df.columns:
        df["bright_ti4"] = df["brightness"]

    if "bright_ti5" not in df.columns and "bright_t31" in df.columns:
        df["bright_ti5"] = df["bright_t31"]

    numeric_columns = [
        "latitude",
        "longitude",
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
        confidence_values = pd.to_numeric(df["confidence"], errors="coerce")
        numeric_confidence = confidence_values.notna()

        if numeric_confidence.any():
            df["confidence_value"] = confidence_values
            df["confidence"] = df["confidence"].astype(object)
            df.loc[numeric_confidence, "confidence"] = (
                confidence_values.loc[numeric_confidence]
                .map(
                    lambda value:
                        "low" if value < 30 else
                        "nominal" if value < 80 else
                        "high"
                )
            )

    return df


def read_csv():

    global fire_df, file_modified

    modified = tuple(csv_file.stat().st_mtime for csv_file in CSV_FILES)

    if fire_df is None or modified != file_modified:

        print("Loading fire datasets...")

        datasets = [
            normalize_dataset(pd.read_csv(csv_file, low_memory=False))
            for csv_file in CSV_FILES
        ]
        df = pd.concat(datasets, ignore_index=True, sort=False)

        fire_df = df
        file_modified = modified

        print(f"Loaded {len(df)} fire records from {len(CSV_FILES)} datasets")

    return fire_df


# ---------------------------------
# 2. CLEAN DATA
# ---------------------------------

def clean_data(df):

    required = [
        "latitude",
        "longitude",
        "bright_ti4",
        "bright_ti5",
        "frp"
    ]

    df = df.dropna(
        subset=[c for c in required if c in df.columns]
    ).copy()

    return df


# ---------------------------------
# 3. FIRE STATISTICS
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

    for sensor_family, source_df in df.groupby("sensor_family"):
        is_modis = sensor_family == "MODIS"
        distribution.append({
            "dataset": "dataset_02.csv" if is_modis else "dataset_01.csv",
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
        df.groupby("acq_date", dropna=True)
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
    ].to_dict("records")


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
        df.groupby("satellite")
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
        df.groupby("sensor_family")
        .agg(
            fire_count=("frp", "count"),
            total_frp=("frp", "sum")
        )
        .reset_index()
    )

    result["dataset"] = result["sensor_family"].map({
        "VIIRS": "dataset_01.csv",
        "MODIS": "dataset_02.csv"
    })

    return result[
        ["dataset", "sensor_family", "fire_count", "total_frp"]
    ].to_dict("records")


# ---------------------------------
# 8. CONFIDENCE DISTRIBUTION
# ---------------------------------

def calculate_confidence(df):

    result = (
        df.groupby("confidence")
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
        df.groupby("daynight")
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

    df = df.copy()
    df["hour"] = pd.to_numeric(
        hours.str[:2], errors="coerce"
    )

    result = (
        df.groupby("hour")
        .size()
        .reset_index(name="fire_count")
        .sort_values("hour")
    )

    return result.to_dict("records")


# ---------------------------------
# 11. GEOGRAPHIC HOTSPOTS
# ---------------------------------

def calculate_hotspots(df):

    df = df.copy()

    df["lat_grid"] = df["latitude"].round(1)
    df["lon_grid"] = df["longitude"].round(1)

    result = (
        df.groupby(["lat_grid", "lon_grid"])
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

    df = clean_data(read_csv())

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


# ---------------------------------
# 14. PAGINATED RAW DATA API
# ---------------------------------

@app.get("/api/fire/data")
async def fire_data(
    offset: int = 0,
    limit: int = 1000
):

    limit = max(1, min(limit, 5000))

    df = await asyncio.to_thread(
        lambda: clean_data(read_csv())
    )

    records = df.iloc[offset:offset + limit]

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
# 15. WEBSOCKET
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

            # Map request: analytics + all raw data
            elif category == "any":

                analytics = await asyncio.to_thread(
                    analyze_fire_data
                )

                df = await asyncio.to_thread(
                    lambda: clean_data(read_csv())
                )

                records = df.astype(object).where(
                    pd.notna(df), None
                )

                await websocket.send_json({
                    "type": "analytics_update",
                    "data": analytics
                })

                await websocket.send_json({
                    "type": "initial_data",
                    "count": len(df),
                    "returned": len(records),
                    "data": records.to_dict("records")
                })

    except WebSocketDisconnect:

        print("Client Disconnected")

    finally:

        if websocket in connections:
            connections.remove(websocket)
