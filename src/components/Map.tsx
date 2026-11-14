"use client";

import { useEffect, useRef, useState } from "react";
import { Map, setWorkerUrl, type GeoJSONSource, LngLatBounds } from "maplibre-gl";
import type { FireData, SensorFamily } from "@/hooks/useFireData";
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
  selectedFire: FireData | null;
  onSelectFire: (fire: FireData | null) => void;
  visibleSensorFamilies: SensorFamily[];
  onToggleSensorFamily: (sensorFamily: SensorFamily) => void;
}

type FireProperties = {
  fireData: string;
  riskScore: number;
  sensorFamily: "MODIS" | "VIIRS";
};

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
      riskScore >= 20 ? "Low" : "Very Low",
  };
}

function getSensorFamily(fire: FireData): SensorFamily {
  return fire.sensor_family ?? (fire.brightness != null ? "MODIS" : "VIIRS");
}

function filterFires(
  fires: FireData[],
  activeRisk: string | null,
  visibleSensorFamilies: SensorFamily[]
) {
  return fires.filter(
    (fire) =>
      visibleSensorFamilies.includes(getSensorFamily(fire)) &&
      (!activeRisk ||
        calculateFireRisk(fire).level.toLowerCase() ===
          activeRisk.toLowerCase())
  );
}

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
        sensorFamily: getSensorFamily(fire),
      },
    })),
  };
}

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

function addPulsingLocation(map: Map) {
  // Location source
  map.addSource("selected-location", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  // Outer pulsing circle
  map.addLayer({
    id: "location-pulse",
    type: "circle",
    source: "selected-location",

    paint: {
      "circle-radius": 10,
      "circle-color": "#f97316",
      "circle-opacity": 0.5,

      "circle-stroke-width": 2,
      "circle-stroke-color": "#f97316",
    },
  });

  // Inner location dot
  map.addLayer({
    id: "location-dot",
    type: "circle",
    source: "selected-location",

    paint: {
      "circle-radius": 7,
      "circle-color": "#f97316",

      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function animateLocationPulse(map: Map) {
  let frame = 0;
  let stopped = false;

  const duration = 1200;

  const animate = (time: number) => {
    if (stopped || !map.getLayer("location-pulse")) {
      return;
    }

    const progress = (time % duration) / duration;

    const radius = 10 + progress * 25;
    const opacity = 0.5 * (1 - progress);

    map.setPaintProperty(
      "location-pulse",
      "circle-radius",
      radius
    );

    map.setPaintProperty(
      "location-pulse",
      "circle-opacity",
      opacity
    );

    frame = requestAnimationFrame(animate);
  };

  frame = requestAnimationFrame(animate);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}

function updateSelectedLocation(
  map: Map,
  longitude: number,
  latitude: number
) {
  const source = map.getSource(
    "selected-location"
  ) as GeoJSONSource | undefined;

  if (!source) return;

  source.setData({
    type: "FeatureCollection",

    features: [
      {
        type: "Feature",

        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },

        properties: {},
      },
    ],
  });
}

function clearSelectedLocation(map: Map) {
  const source = map.getSource(
    "selected-location"
  ) as GeoJSONSource | undefined;

  source?.setData({
    type: "FeatureCollection",
    features: [],
  });
}

export default function MapComponent({
  fires,
  selectedCountry,
  long,
  lat,
  activeRisk,
  selectedFire,
  onSelectFire,
  visibleSensorFamilies,
  onToggleSensorFamily,
}: MapComponentProps) {

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  const animationCleanup = useRef<(() => void) | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,

      style: "https://tiles.openfreemap.org/styles/liberty",

      center: [80.7718, 7.8731],
      zoom: 7,
      minZoom: 0,
      renderWorldCopies: false,
    });

    mapRef.current = map;

    map.on("load", () => {

      // FIRE SOURCE
      map.addSource("fires", {
        type: "geojson",

        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // FIRE LAYER
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

          "circle-color": [
            "match",
            ["get", "sensorFamily"],
            "MODIS", "#3b82f6",
            "#f97316",
          ],
          "circle-stroke-width": 3,
          "circle-stroke-color": [
            "match",
            ["get", "sensorFamily"],
            "MODIS", "#3b82f6",
            "#f97316",
          ],
        },
      });

      // ADD SELECTED LOCATION MARKER
      addPulsingLocation(map);

      // START PULSE ANIMATION
      animationCleanup.current = animateLocationPulse(map);

      // MAP READY
      setMapLoaded(true);

      // CLICK FIRE POINT
      map.on("click", "fire-points", (event) => {
        const feature = event.features?.[0];

        if (!feature?.properties?.fireData) return;

        const fire: FireData = JSON.parse(
          feature.properties.fireData
        );

        onSelectFire(fire);
        updateSelectedLocation(map, fire.longitude, fire.latitude);
      });

      // POINTER CURSOR
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

    // CLEANUP
    return () => {
      animationCleanup.current?.();
      animationCleanup.current = null;

      mapRef.current = null;

      map.remove();
    };

  }, [onSelectFire]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    const filteredFires = filterFires(
      fires,
      activeRisk,
      visibleSensorFamilies
    );

    updateFireSource(
      mapRef.current,
      filteredFires
    );

  }, [fires, activeRisk, visibleSensorFamilies, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    if (!selectedFire || !visibleSensorFamilies.includes(getSensorFamily(selectedFire))) {
      clearSelectedLocation(mapRef.current);
    }
  }, [selectedFire, visibleSensorFamilies, mapLoaded]);

  useEffect(() => {
    if (
      !mapLoaded ||
      !mapRef.current ||
      !selectedCountry
    ) return;

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

  function getRiskRatio(fire: FireData) {
    return calculateFireRisk(fire);
  }

  function targetLocation(
    longitude: number,
    latitude: number
  ) {
    if (!mapRef.current) return;

    const map = mapRef.current;

    // UPDATE BLINKING LOCATION MARKER
    updateSelectedLocation(
      map,
      longitude,
      latitude
    );

    // FLY TO SELECTED LOCATION
    map.flyTo({
      center: [longitude, latitude],
      zoom: 8,
      duration: 1500,
      essential: true,
    });
  }

  useEffect(() => {
    if (
      !mapLoaded ||
      long === null ||
      lat === null
    ) return;

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

      {/* MAPLIBRE CONTAINER */}
      <div
        ref={mapContainer}
        className="w-full h-full"
      />

      <div className="mapLegend" aria-label="Toggle fire sensor datasets">
        <button
          type="button"
          className={`mapLegendToggle mapLegendToggle--viirs ${
            visibleSensorFamilies.includes("VIIRS") ? "isActive" : ""
          }`}
          aria-pressed={visibleSensorFamilies.includes("VIIRS")}
          onClick={() => onToggleSensorFamily("VIIRS")}
        >
          <i className="mapLegendSwatch mapLegendSwatch--viirs" />
          <span>VIIRS / dataset_01</span>
        </button>
        <button
          type="button"
          className={`mapLegendToggle mapLegendToggle--modis ${
            visibleSensorFamilies.includes("MODIS") ? "isActive" : ""
          }`}
          aria-pressed={visibleSensorFamilies.includes("MODIS")}
          onClick={() => onToggleSensorFamily("MODIS")}
        >
          <i className="mapLegendSwatch mapLegendSwatch--modis" />
          <span>MODIS / dataset_02</span>
        </button>
      </div>

      <div className="zoomTools">
        <button
          type="button"
          className="zoomIn"
          aria-label="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="zoomOut"
          aria-label="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
      </div>

      {/* FIRE DETAILS PANEL */}
      {selectedFire && (
        <div className="detailsPanel">

          <div className="macOSCloseControler">
            <button
              onClick={() => onSelectFire(null)}
            >
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
            <p>
              {selectedFire.sensor_family === "MODIS"
                ? "Brightness (MODIS)"
                : "Brightness TI4"}
              : {selectedFire.sensor_family === "MODIS"
                ? selectedFire.brightness ?? selectedFire.bright_ti4
                : selectedFire.bright_ti4}
            </p>
            <p>
              {selectedFire.sensor_family === "MODIS"
                ? "Brightness T31"
                : "Brightness TI5"}
              : {selectedFire.sensor_family === "MODIS"
                ? selectedFire.bright_t31 ?? selectedFire.bright_ti5
                : selectedFire.bright_ti5}
            </p>
            <p>
              Confidence: {selectedFire.confidence_value ?? selectedFire.confidence}
              {selectedFire.confidence_value != null ? "%" : ""}
            </p>
            <p>Sensor: {selectedFire.sensor_family ?? "VIIRS"}</p>
            <p>FRP: {selectedFire.frp}</p>
            <p>Date: {selectedFire.acq_date}</p>
            <p>Satellite: {selectedFire.satellite}</p>

          </div>
        </div>
      )}

      

    </section>
  );
}
