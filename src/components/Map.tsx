"use client";

import { useEffect, useRef, useState } from "react";
import { Map, setWorkerUrl, type GeoJSONSource, LngLatBounds } from "maplibre-gl";
import type { FireData } from "@/hooks/useFireData";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url
  ).toString()
);

interface MapComponentProps {
  fires: FireData[];
  selectedCountry: string;
  long: number | null;
  lat: number | null;
  activeRisk: string | null;
}

type FireProperties = {
  fireData: string;
  riskScore: number;
};

// Calculate fire risk
function calculateFireRisk(fire: FireData) {
  const frpScore = Math.min(
    100,
    Math.max(
      0,
      (Math.log1p(fire.frp) / Math.log1p(100)) * 100
    )
  );

  const tempScore = Math.min(
    100,
    Math.max(
      0,
      ((fire.bright_ti4 - 250) / 150) * 100
    )
  );

  const confidence = String(fire.confidence).toLowerCase();

  const confidenceScore =
    confidence === "high" ? 100 :
    confidence === "nominal" ? 70 :
    confidence === "low" ? 30 : 0;

  const riskScore =
    frpScore * 0.40 +
    confidenceScore * 0.35 +
    tempScore * 0.25;

  return {
    score: Number(riskScore.toFixed(2)),
    level:
      riskScore >= 80 ? "Critical" :
      riskScore >= 60 ? "High" :
      riskScore >= 40 ? "Moderate" :
      riskScore >= 20 ? "Low" : "Very Low"
  };
}

// Filter fires according to selected risk
function filterFires(
  fires: FireData[],
  activeRisk: string | null
) {
  if (!activeRisk) return fires;

  return fires.filter(
    (fire) =>
      calculateFireRisk(fire).level.toLowerCase() ===
      activeRisk.toLowerCase()
  );
}

// Convert fire data into GeoJSON
function createFireGeoJSON(
  fires: FireData[]
): FeatureCollection<Point, FireProperties> {
  return {
    type: "FeatureCollection",

    features: fires.map((fire) => ({
      type: "Feature",

      geometry: {
        type: "Point",
        coordinates: [
          fire.longitude,
          fire.latitude,
        ],
      },

      properties: {
        fireData: JSON.stringify(fire),
        riskScore: calculateFireRisk(fire).score,
      },
    })),
  };
}

// Update fire source
function updateFireSource(
  map: Map,
  fires: FireData[]
) {
  const source = map.getSource("fires") as
    | GeoJSONSource
    | undefined;

  if (!source) return;

  source.setData(createFireGeoJSON(fires));
}

export default function MapComponent({
  fires,
  selectedCountry,
  long,
  lat,
  activeRisk,
}: MapComponentProps) {

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  const [selectedFire, setSelectedFire] =
    useState<FireData | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [80.7718, 7.8731],
      zoom: 7,
    });

    mapRef.current = map;

    map.on("load", () => {

      // Add fire GeoJSON source
      map.addSource("fires", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // Add fire circle layer
      map.addLayer({
        id: "fire-points",
        type: "circle",
        source: "fires",

        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5, 3,
            10, 6,
            15, 9,
          ],

          "circle-color": "#f97316",
          "circle-stroke-width": 4,
          "circle-stroke-color": "#f97316"
        },
      });

      // Map is ready
      setMapLoaded(true);

      // Click fire point
      map.on("click", "fire-points", (event) => {
        const feature = event.features?.[0];

        if (!feature?.properties?.fireData) return;

        const fire: FireData = JSON.parse(
          feature.properties.fireData
        );

        setSelectedFire(fire);
      });

      // Pointer cursor
      map.on("mouseenter", "fire-points", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "fire-points", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    map.on("error", (event) => {
      console.error("MapLibre error:", event.error);
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Update fire locations and filter by risk
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const filteredFires = filterFires(fires, activeRisk);

    updateFireSource(
      mapRef.current,
      filteredFires
    );

  }, [fires, activeRisk, mapLoaded]);

  // Search country
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !selectedCountry) return;

    let cancelled = false;

    fetch("/countries.geojson")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load countries");
        }

        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        const feature = data.features.find(
          (f: any) =>
            f.properties.name.toLowerCase() ===
            selectedCountry.toLowerCase()
        );

        if (!feature) return;

        const bounds = new LngLatBounds();

        const extendCoordinates = (coords: any) => {
          if (typeof coords[0] === "number") {
            bounds.extend(coords as [number, number]);
          } else {
            coords.forEach(extendCoordinates);
          }
        };

        extendCoordinates(feature.geometry.coordinates);

        mapRef.current?.fitBounds(bounds, {
          padding: 60,
          duration: 1500,
          maxZoom: 7,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Country search error:", error);
        }
      });

    return () => {
      cancelled = true;
    };

  }, [selectedCountry, mapLoaded]);

  // Calculate risk ratio
  function getRiskRatio(fire: FireData) {
    return calculateFireRisk(fire);
  }

  // Search location using longitude and latitude
  function targetLocation(
    longitude: number,
    latitude: number
  ) {
    if (!mapRef.current) return;

    mapRef.current.flyTo({
      center: [longitude, latitude],
      zoom: 8,
      duration: 1500,
      essential: true,
    });
  }

  // Watch coordinate changes from page.tsx
  useEffect(() => {
    if (!mapLoaded || long === null || lat === null) return;

    if (
      !Number.isFinite(long) ||
      !Number.isFinite(lat) ||
      long < -180 ||
      long > 180 ||
      lat < -90 ||
      lat > 90
    ) return;

    targetLocation(long, lat);

  }, [long, lat, mapLoaded]);

  return (
    <section className="x-full h-full mapContent">

      {/* MapLibre container */}
      <div
        ref={mapContainer}
        className="w-full h-full"
      />

      {/* Fire details panel */}
      {selectedFire && (
        <div className="detailsPanel">

          <div className="macOSCloseControler">
            <button onClick={() => setSelectedFire(null)}>
              ×
            </button>
          </div>

          <div className="detailsContainer">

            <span
              className={`indic ${getRiskRatio(selectedFire).level.toLowerCase().replace(" ", "-")}`}
            >
              {getRiskRatio(selectedFire).level}
            </span>

            <h3>
              <strong>Fire Detection</strong>
            </h3>

            <p>Latitude: {selectedFire.latitude}</p>
            <p>Longitude: {selectedFire.longitude}</p>
            <p>Brightness TI4: {selectedFire.bright_ti4}</p>
            <p>Brightness TI5: {selectedFire.bright_ti5}</p>
            <p>Confidence: {selectedFire.confidence}</p>
            <p>FRP: {selectedFire.frp}</p>
            <p>Date: {selectedFire.acq_date}</p>
            <p>Satellite: {selectedFire.satellite}</p>

          </div>
        </div>
      )}

    </section>
  );
}
