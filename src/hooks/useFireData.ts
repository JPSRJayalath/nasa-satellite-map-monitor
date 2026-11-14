
"use client";

import { useEffect, useState } from "react";

// ----------------------------------
// FIRE DATA INTERFACE
// ----------------------------------

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

// ----------------------------------
// ANALYTICS INTERFACE
// ----------------------------------

export interface FireAnalyticsData {
    summary: {
        total_fires: number;
        total_frp: number;
        average_frp: number;
        maximum_frp: number;
        minimum_frp: number;
        average_ti4: number;
        average_ti5: number;
    };

    frp_distribution: {
        date: string;
        total_frp: number;
        average_frp: number;
        fire_count: number;
    }[];

    temperature: {
        name: string;
        value: number;
    }[];

    satellite_distribution: {
        name: string;
        count: number;
    }[];

    confidence_distribution: {
        name: string;
        count: number;
    }[];

    daynight_distribution: {
        name: string;
        count: number;
    }[];

    hourly_distribution: {
        hour: number;
        fire_count: number;
    }[];

    geographic_distribution: {
        lat_grid: number;
        lon_grid: number;
        fire_count: number;
        total_frp: number;
    }[];
}

// ----------------------------------
// WEBSOCKET HOOK
// ----------------------------------

export function useFireData() {

    const [fires, setFires] = useState<FireData[]>([]);

    const [analytics, setAnalytics] =
        useState<FireAnalyticsData | null>(null);

    const [connected, setConnected] = useState(false);

    const [loading, setLoading] = useState(true);

    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {

        let ws: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout>;
        let reconnectAttempts = 0;
        let mounted = true;
        let manuallyClosed = false;

        const connect = () => {

            if (!mounted || manuallyClosed) return;

            ws = new WebSocket("ws://localhost:9000/ws");

            ws.onopen = () => {

                if (!mounted) return;

                setConnected(true);
                setErr(null);

                reconnectAttempts = 0;

                console.log("Fire server connected");

                ws?.send(JSON.stringify({
                    app: "NASA Fire Monitor",
                    permission: "read",
                    category: "any"
                }));
            };

            ws.onmessage = (event) => {

                if (!mounted) return;

                try {

                    const message = JSON.parse(event.data);

                    switch (message.type) {

                        case "initial_data":

                            setFires(message.data ?? []);
                            setLoading(false);

                            console.log(
                                "Fire records received:",
                                message.count
                            );

                            break;

                        case "analytics_update":

                            setAnalytics(message.data ?? null);
                            setLoading(false);

                            console.log("Analytics received");

                            break;

                        case "error":

                            setErr(
                                message.decline ??
                                "Unknown server error"
                            );

                            break;

                        default:

                            console.warn(
                                "Unknown WebSocket message:",
                                message.type
                            );

                    }

                } catch (error) {

                    console.error("Invalid server response:", error);

                    setErr("Invalid server response");

                }
            };

            ws.onerror = () => {

                if (!mounted) return;

                setErr("WebSocket connection error");

            };

            ws.onclose = () => {

                if (!mounted) return;

                setConnected(false);

                console.log("Fire server disconnected");

                if (!manuallyClosed) {

                    reconnectAttempts++;

                    const delay = Math.min(
                        1000 * 2 ** reconnectAttempts,
                        30000
                    );

                    reconnectTimer = setTimeout(
                        connect,
                        delay
                    );
                }
            };
        };

        connect();

        return () => {

            mounted = false;
            manuallyClosed = true;

            clearTimeout(reconnectTimer);

            if (ws) {
                ws.close();
            }
        };

    }, []);

    return {
        fires,
        analytics,
        connected,
        loading,
        err
    };
}
