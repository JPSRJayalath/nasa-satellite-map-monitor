"use client";

import type { ReactNode } from "react";
import { useFireData } from "@/hooks/useFireData";
import {
  ResponsiveContainer,
  BarChart,
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
  const { fires, analytics, connected, loading, err } = useFireData();

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
          <h1>VIIRS Fire Monitoring</h1>
          <p>Satellite Fire Detection &amp; Analytics Dashboard</p>
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

      <section className="fireTemperatureGrid" aria-label="Average brightness">
        <article className="fireTemperatureCard">
          <p>Average Brightness TI4</p>
          <h2>{stats.average_ti4} K</h2>
        </article>
        <article className="fireTemperatureCard">
          <p>Average Brightness TI5</p>
          <h2>{stats.average_ti5} K</h2>
        </article>
      </section>

      <div className="fireChartsGrid">
        <ChartCard title="Fire Radiative Power">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.frp_distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="total_frp"
                name="Total FRP (MW)"
                fill="#f97316"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Brightness Temperature">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.temperature}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="value"
                name="Temperature (K)"
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
