"use client";

import type { ReactNode } from "react";
import { useFireData } from "@/hooks/useFireData";
import {
  ResponsiveContainer,
  BarChart,
  ComposedChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#f97316", "#3b82f6", "#10b981", "#a855f7", "#eab308"];

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="fireChartCard">
      <h2 className="fireChartTitle">{title}</h2>
      <div className="fireChartPlot">{children}</div>
    </section>
  );
}

export default function FireDashboard() {
  const { analytics, connected, loading, err } = useFireData("analytics");

  if (loading && !analytics) {
    return (
      <div className="fireDashboardState" role="status">
        Loading fire analytics...
      </div>
    );
  }

  if (err && !analytics) {
    return (
      <div className="fireDashboardState fireDashboardError" role="alert">
        {err}
      </div>
    );
  }

  if (!analytics) return null;

  const stats = analytics.summary;
  const cards = [
    {
      title: "Total Detections",
      value: stats.total_fires.toLocaleString(),
      unit: "Fire hotspots",
      accent: "orange",
    },
    {
      title: "Total FRP",
      value: stats.total_frp.toLocaleString(),
      unit: "MW",
      accent: "red",
    },
    {
      title: "Average FRP",
      value: stats.average_frp.toFixed(2),
      unit: "MW",
      accent: "blue",
    },
    {
      title: "Maximum FRP",
      value: stats.maximum_frp.toFixed(2),
      unit: "MW",
      accent: "purple",
    },
  ];

  return (
    <main className="fireDashboard">
      <header className="fireDashboardHeader">
        <div className="fireDashboardHeading">
          <h1>Multi-Sensor Fire Monitoring</h1>
          <p>Combined VIIRS and MODIS fire detection analytics</p>
        </div>

        <div className="fireConnectionStatus">
          <span
            className={`fireConnectionIndicator ${
              connected ? "isConnected" : "isDisconnected"
            }`}
            aria-hidden="true"
          />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </header>

      <section className="fireStatsGrid" aria-label="Fire summary">
        {cards.map((card) => (
          <article className="fireStatCard" key={card.title}>
            <p className="fireStatLabel">{card.title}</p>
            <h2 className={`fireStatValue fireStatValue--${card.accent}`}>
              {card.value}
            </h2>
            <p className="fireStatUnit">{card.unit}</p>
          </article>
        ))}
      </section>

      <section className="fireTemperatureGrid" aria-label="Average brightness by dataset">
        {analytics.brightness_distribution.map((source) => (
          <article className="fireTemperatureCard" key={source.dataset}>
            <p>{source.sensor_family} / {source.dataset}</p>
            <div className="fireTemperatureValues">
              <div>
                <span>{source.channel_1_name}</span>
                <strong>{source.channel_1_average} K</strong>
              </div>
              <div>
                <span>{source.channel_2_name}</span>
                <strong>{source.channel_2_average} K</strong>
              </div>
            </div>
          </article>
        ))}
      </section>

      <div
        className="fireChartsGrid"
        role="group"
        aria-label="Fire analytics chart gallery"
      >
        <ChartCard title="Daily Detections & Average FRP">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={analytics.frp_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="detections" allowDecimals={false} />
              <YAxis yAxisId="frp" orientation="right" />
              <Tooltip />
              <Legend />
              <Bar
                yAxisId="detections"
                dataKey="fire_count"
                name="Fire detections"
                fill="#f97316"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="frp"
                type="monotone"
                dataKey="average_frp"
                name="Average FRP (MW)"
                stroke="#3b82f6"
                strokeWidth={3}
                dot
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average Brightness by Dataset">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.brightness_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dataset" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="channel_1_average"
                name="Channel 1 average (K)"
                fill="#f97316"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="channel_2_average"
                name="Channel 2 average (K)"
                fill="#3b82f6"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Hourly Fire Detections">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={analytics.hourly_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="hour"
                tickFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`}
              />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="fire_count"
                name="Fire detections"
                stroke="#ef4444"
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Satellite Distribution">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={analytics.satellite_distribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="70%"
                label
              >
                {analytics.satellite_distribution.map((_, index) => (
                  <Cell
                    key={index}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Detections by Dataset">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.source_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dataset" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="fire_count"
                name="Fire detections"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              >
                {analytics.source_distribution.map((source) => (
                  <Cell
                    key={source.dataset}
                    fill={source.sensor_family === "MODIS" ? "#3b82f6" : "#f97316"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Detection Confidence">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={analytics.confidence_distribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="70%"
                label
              >
                {analytics.confidence_distribution.map((_, index) => (
                  <Cell
                    key={index}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Day / Night Distribution">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.daynight_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="count"
                name="Detections"
                fill="#8b5cf6"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </main>
  );
}
