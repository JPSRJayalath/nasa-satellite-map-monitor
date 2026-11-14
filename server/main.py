
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import pandas as pd
import numpy as np
import asyncio

app = FastAPI()

CSV_FILE = Path("datasets/dataset_01.csv")

connections: list[WebSocket] = []

# Cached dataset
fire_df: Optional[pd.DataFrame] = None
file_modified: Optional[float] = None


# ---------------------------------
# 1. LOAD AND CACHE CSV
# ---------------------------------

def read_csv():

    global fire_df, file_modified

    modified = CSV_FILE.stat().st_mtime

    if fire_df is None or modified != file_modified:

        print("Loading fire dataset...")

        df = pd.read_csv(CSV_FILE, low_memory=False)

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
                df[col] = pd.to_numeric(
                    df[col], errors="coerce"
                )

        fire_df = df
        file_modified = modified

        print(f"Loaded {len(df)} fire records")

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
# 7. CONFIDENCE DISTRIBUTION
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
# 8. DAY / NIGHT DISTRIBUTION
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
# 9. HOURLY DISTRIBUTION
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
# 10. GEOGRAPHIC HOTSPOTS
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
# 11. COMPLETE ANALYTICS
# ---------------------------------

def analyze_fire_data():

    df = clean_data(read_csv())

    return {
        "summary": calculate_summary(df),
        "frp_distribution": calculate_frp(df),
        "temperature": calculate_temperature(df),
        "satellite_distribution": calculate_satellites(df),
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

            # Legacy request: analytics + limited raw data
            elif category == "any":

                analytics = await asyncio.to_thread(
                    analyze_fire_data
                )

                df = await asyncio.to_thread(
                    lambda: clean_data(read_csv())
                )

                records = df.head(1000).astype(object).where(
                    pd.notna(df.head(1000)), None
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
