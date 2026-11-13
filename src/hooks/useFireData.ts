"use client";

import { useEffect, useState } from "react";

export interface FireData {
    latitude: number;
    longitude: number;
    bright_ti4: number;
    scan: number;
    track: number;
    acq_date: string;
    acq_time: string;
    satellite: string;
    confidence: number | string;
    version: string;
    bright_ti5: number;
    frp: number;
    daynight: string;
}

export function useFireData() {
    const [fires, setFires] = useState<FireData[]>([]);
    const [connected, setConnected] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        const ws = new WebSocket("ws://localhost:9000/ws");

        ws.onopen = () => {
            setConnected(true);
            console.log("Connected");
            setErr(null);

            ws.send(JSON.stringify({
                app: "NASA Fire Monitor",
                permission: "read",
                category: "any"
            }));
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case "initial_data":
                        setFires(message.data);
                        break;

                    case "error":
                        setErr(message.decline ?? "Unknown server error");
                        break;
                }
            } catch {
                setErr("Invalid server response");
            }
        };

        ws.onerror = () => {
            setErr("WebSocket connection error");
        };

        ws.onclose = () => {
            setConnected(false);
            console.log("Disconnected")
        };

        return () => {
            ws.close();
        };
    }, []);

    return { fires, connected, err };
}