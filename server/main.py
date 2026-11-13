from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List
import pandas as pd

app = FastAPI()

CSV_FILE = Path("datasets/dataset_01.csv")

connections: List[WebSocket] = []

def read_csv():
    df = pd.read_csv(CSV_FILE)
    df_n = df.where(pd.notnull(df), None)

    return df.to_dict(orient="records")

@app.get("/")
async def root():
    return {"status": "Fire Monitoring Server Online"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connections.append(websocket)

    print("Client Connected")

    try:
        while True:
            message = await websocket.receive_json()
            if message.get("app") == "NASA Fire Monitor":
                if message.get("permission") == "read":
                    if message.get("category") == "any":
                        data = read_csv()
                        await websocket.send_json({
                            "type": "initial_data",
                            "count": len(data),
                            "data": data
                        })

    except WebSocketDisconnect:
        print("Client Disconnected")
        await websocket.send_json({
            "type": "error",
            "decline": "Permission Denied"
        })

    finally:
        if websocket in connections:
            connections.remove(websocket)


if __name__ == "__main__":
    pass