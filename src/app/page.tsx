"use client";

import dynamic from "next/dynamic";
import { useFireData } from "@/hooks/useFireData";
import { useState, useEffect } from "react";
import Image from "next/image";
import type { FireData } from "@/hooks/useFireData";

interface Country {
  properties: {
    name: string;
  };
}


const MapComponent = dynamic(() => import("@/components/Map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen">
        Loading map...
      </div>
    ),
  }
);

export default function Home() {
  const { fires, connected, err } = useFireData();
  const [isMapVisible, setIsMapVisible] = useState<boolean>(false);
  const [isMainOptionPanel, setIsMainOptionPanel] = useState<boolean>(true);
  const [isAnalyzePanel, setIsAnalyzePanel] = useState<boolean>(false);
  const [countries, setCounries] = useState<string[]>([]);
  const [selectedContry, setSelectedCountry] = useState("");
  const [isLong, setIsLong] = useState<number | null>(null);
  const [isLat, setIsLat] = useState<number | null>(null);
  const [isActiveRisk, setIsActiveRisk] = useState<any | null>(null)

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

  useEffect(() => {
    fetch('/countries.geojson')
    .then((res) => res.json())
    .then((data) => {
      const names = data.features
        .map((feature: Country) => feature.properties.name)
        .sort();
      setCounries(names);
    });
  }, []);
  
  return (
    <main className="w-screen h-screen mainElement">
      <div className="errMessage">
        <span>Error: {err !== "null" ? err : "null"}</span>
        <button>×</button>
      </div>
      <section className="mainContainer">
        <div className="MainOptionPanel" style={{display: isMainOptionPanel ? "flex" : "none"}}>
          <div className="logoContainer">
            <Image
              src="/logo.png"
              alt="logo"
              width={300}
              height={300}
              priority
              loading="eager"
              className="logo"
            />
            <h1>NASA Fire Moniter</h1>
          </div>
          <div className="optionsContainer">
            <div>
              <button className="mapOpen" onClick={() => {setIsMainOptionPanel(false); setIsMapVisible(true)}}>
                <div>
                  <Image
                    src="map.svg"
                    width={300}
                    height={300}
                    priority
                    loading="eager"
                    alt="mapIcon"
                    className="mapIcon"
                  />
                  <span>Open Map</span>
                </div>
              </button>
            </div>
            <div>
              <button className="analyzePanelOpen" onClick={() => {setIsMainOptionPanel(false); setIsAnalyzePanel(true)}}>
                <div>
                  <div className="chartIMG">
                    <svg width="800px" height="800px" viewBox="0 -0.5 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5.11413 8.35688C4.75894 8.56999 4.64377 9.03069 4.85688 9.38587C5.06999 9.74106 5.53069 9.85623 5.88587 9.64312L5.11413 8.35688ZM10.5 6L10.95 5.4C10.7061 5.21704 10.3756 5.19999 10.1141 5.35688L10.5 6ZM14.5 9L14.05 9.6C14.3236 9.80522 14.7014 9.79932 14.9685 9.58565L14.5 9ZM19.9685 5.58565C20.292 5.32689 20.3444 4.85493 20.0857 4.53148C19.8269 4.20803 19.3549 4.15559 19.0315 4.41435L19.9685 5.58565ZM17.75 19C17.75 19.4142 18.0858 19.75 18.5 19.75C18.9142 19.75 19.25 19.4142 19.25 19H17.75ZM19.25 11C19.25 10.5858 18.9142 10.25 18.5 10.25C18.0858 10.25 17.75 10.5858 17.75 11H19.25ZM9.75 19C9.75 19.4142 10.0858 19.75 10.5 19.75C10.9142 19.75 11.25 19.4142 11.25 19H9.75ZM11.25 11C11.25 10.5858 10.9142 10.25 10.5 10.25C10.0858 10.25 9.75 10.5858 9.75 11H11.25ZM13.75 19C13.75 19.4142 14.0858 19.75 14.5 19.75C14.9142 19.75 15.25 19.4142 15.25 19H13.75ZM15.25 14C15.25 13.5858 14.9142 13.25 14.5 13.25C14.0858 13.25 13.75 13.5858 13.75 14H15.25ZM5.75 19C5.75 19.4142 6.08579 19.75 6.5 19.75C6.91421 19.75 7.25 19.4142 7.25 19H5.75ZM7.25 14C7.25 13.5858 6.91421 13.25 6.5 13.25C6.08579 13.25 5.75 13.5858 5.75 14H7.25ZM5.88587 9.64312L10.8859 6.64312L10.1141 5.35688L5.11413 8.35688L5.88587 9.64312ZM10.05 6.6L14.05 9.6L14.95 8.4L10.95 5.4L10.05 6.6ZM14.9685 9.58565L19.9685 5.58565L19.0315 4.41435L14.0315 8.41435L14.9685 9.58565ZM19.25 19V11H17.75V19H19.25ZM11.25 19V11H9.75V19H11.25ZM15.25 19V14H13.75V19H15.25ZM7.25 19V14H5.75V19H7.25Z" className="chartSVG"/>
                    </svg>
                  </div>
                  <span>Open Map</span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div className="mapControlers" style={{display: isMainOptionPanel ? "none" : "block"}}>
          <h2>Filters</h2>
          <input type="text" placeholder="Country" value={selectedContry} list="countries" onChange={(e) => setSelectedCountry(e.target.value)} />
          <datalist id="countries">
            {countries.map((country) => (
              <option key={country} value={country} />
            ))}
          </datalist>
          <div className="riskRatio">
            <button onClick={() => setIsActiveRisk(null)} className="Critical critical">All</button>
            <button onClick={() => setIsActiveRisk("critical")} className="Critical critical">Critical</button>
            <button onClick={() => setIsActiveRisk("high")} className="High high">High</button>
            <button onClick={() => setIsActiveRisk("moderate")} className="Moderate moderate">Moderate</button>
            <button onClick={() => setIsActiveRisk("low")} className="Low low">Low</button>
          </div>
          <div className="locations">
            {isActiveRisk === null && (
              fires.map((loc, index) => (
                <div
                  onClick={() => {
                    setIsLat(loc.latitude);
                    setIsLong(loc.longitude);
                  }}
                  className="loc"
                  key={index}
                >
                  <div className="locDetails">
                    <span>Longitude: {loc.longitude}</span>
                    <span>Latitude: {loc.latitude}</span>
                  </div>

                  <div>
                    <span className={`riskIndiLoc ${calculateFireRisk(loc).level.toLowerCase()}`}>
                      {calculateFireRisk(loc).level}
                    </span>
                  </div>
                </div>
              ))
            )}
            {isActiveRisk !== null && (
              fires
                .filter((loc) => calculateFireRisk(loc).level.toLowerCase() === isActiveRisk)
                .map((loc, index) => (
                  <div
                    onClick={() => {
                      setIsLat(loc.latitude);
                      setIsLong(loc.longitude);
                    }}
                    className="loc"
                    key={`${loc.latitude}-${loc.longitude}`}
                  >
                    <div className="locDetails">
                      <span>Longitude: {loc.longitude}</span>
                      <span>Latitude: {loc.latitude}</span>
                    </div>

                    <div>
                      <span className={`riskIndiLoc ${calculateFireRisk(loc).level.toLowerCase()}`}>
                        {calculateFireRisk(loc).level}
                      </span>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
        <div className="mapContainer" style={{display: isMapVisible ? "block" : "none"}}>
          <MapComponent fires={fires} selectedCountry={selectedContry} long={isLong} lat={isLat} activeRisk={isActiveRisk}/>
          <button className="mapClose" onClick={() => {setIsMainOptionPanel(true); setIsMapVisible(false)}}>×</button>
        </div>
      </section>
    </main>
  );
}