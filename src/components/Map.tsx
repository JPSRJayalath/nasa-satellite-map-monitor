"use client";

import { useEffect, useRef, useState } from "react";
import { Map, setWorkerUrl, Popup, type GeoJSONSource, LngLatBounds } from "maplibre-gl";
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
}

// Convert fire data into GeoJSON
function createFireGeoJSON(
  fires: FireData[]
): FeatureCollection<Point, { fireData: string }> {
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
  fires, selectedCountry
}: MapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [ selectedFire, setSelectedFire ] = useState<FireData | null>(null);

  // Always keep the latest fire data
  const firesRef = useRef(fires);
  firesRef.current = fires;

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

          "circle-color": "#ef4444",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ef4444",
        },
      });

      // Load the latest fire data after source creation
      updateFireSource(map, firesRef.current);

      // Click fire point
      map.on("click", "fire-points", (event) => {
        const feature = event.features?.[0];

        if (!feature?.properties) return;

        const fire: FireData = JSON.parse(
          feature.properties.fireData
        )

        setSelectedFire(fire)
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

  // Update fire locations whenever dataset changes
  useEffect(() => {
    const map = mapRef.current;

    if (!map) return;

    updateFireSource(map, fires);
  }, [fires]);

  useEffect(() => {
    if (!mapRef.current || !selectedCountry) return;

    fetch("/countries.geojson")
      .then((res) => res.json())
      .then((data) => {
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

        mapRef.current!.fitBounds(bounds, {
          padding: 60,
          duration: 1500,
          maxZoom: 7,
        });
      });
  }, [selectedCountry]);

  return (
    <section className="x-full h-full mapContent">
      <div ref={mapContainer} className="w-full h-full">
        {selectedFire && (
          <div className="detailsPanel" style={{display: selectedFire ? "block" : "none"}}>
            <div className="macOSCloseControler">
              <button onClick={() => setSelectedFire(null)}>×</button>
            </div>
            <div className="detailsContainer">
              <h3><strong>Fire Detection</strong></h3>
              <p>Latitude: {selectedFire.latitude}</p>
              <p>Longtitude: {selectedFire.longitude}</p>
              <p>Brightness: {selectedFire.bright_ti4}</p>
              <p>Brightness: {selectedFire.bright_ti5}</p>
              <p>Confidense: {selectedFire.confidence}</p>
              <p>FRP: {selectedFire.frp}</p>
              <p>Date: {selectedFire.acq_date}</p>
              <p>Satellite: {selectedFire.satellite}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
