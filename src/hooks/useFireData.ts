
"use client";

import { useEffect, useState } from "react";

// ----------------------------------
// FIRE DATA INTERFACE
// ----------------------------------

export type SensorFamily = "MODIS" | "VIIRS";

export interface FireMapDataInfo {
    total: number;
    returned: number;
    years: string[];
}

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
    confidence_value?: number | null;
    sensor_family?: SensorFamily;
    dataset_name?: string;
    brightness?: number | null;
    bright_t31?: number | null;
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

    brightness_distribution: {
        dataset: string;
        sensor_family: "MODIS" | "VIIRS";
        channel_1_name: string;
        channel_1_average: number;
        channel_2_name: string;
        channel_2_average: number;
    }[];

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

    source_distribution: {
        dataset: string;
        sensor_family: "MODIS" | "VIIRS";
        fire_count: number;
        total_frp: number;
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

export function useFireData(category: "analytics" | "any" = "any") {

    const [fires, setFires] = useState<FireData[]>([]);

    const [analytics, setAnalytics] =
        useState<FireAnalyticsData | null>(null);

    const [connected, setConnected] = useState(false);

    const [loading, setLoading] = useState(true);

    const [err, setErr] = useState<string | null>(null);

    const [mapDataInfo, setMapDataInfo] =
        useState<FireMapDataInfo | null>(null);

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
                    category
                }));
            };

            ws.onmessage = (event) => {

                if (!mounted) return;

                try {

                    const message = JSON.parse(event.data);

                    switch (message.type) {

                        case "initial_data": {

                            const mapRecords = Array.isArray(message.data)
                                ? message.data
                                : [];
                            const total = typeof message.count === "number"
                                ? message.count
                                : mapRecords.length;
                            const returned = typeof message.returned === "number"
                                ? message.returned
                                : mapRecords.length;
                            const years = Array.isArray(message.years)
                                ? message.years
                                : [];

                            setFires(mapRecords);
                            setMapDataInfo({ total, returned, years });
                            setLoading(false);

                            console.log(
                                "Fire records received:",
                                total,
                                "location-list records:",
                                returned
                            );

                            break;
                        }

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

    }, [category]);

    return {
        fires,
        analytics,
        connected,
        loading,
        err,
        mapDataInfo
    };
}
