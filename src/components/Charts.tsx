"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
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
  Sector,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = ["#f97316", "#3b82f6", "#10b981", "#a855f7", "#eab308"];
const FIRE_API_URL = "http://localhost:9000";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const EMPTY_CALENDAR_FILTERS = {
  startDate: "",
  endDate: "",
  west: "",
  south: "",
  east: "",
  north: "",
};

interface FireCalendarFilters {
  startDate: string;
  endDate: string;
  west: string;
  south: string;
  east: string;
  north: string;
}

interface FireCalendarCell {
  year: number;
  month: number;
  fire_count: number | null;
  historical_median: number | null;
  anomaly: number | null;
  in_range: boolean;
  complete_month: boolean;
}

interface FireCalendarData {
  available_start_date: string | null;
  available_end_date: string | null;
  start_date?: string;
  end_date?: string;
  total_detections: number;
  calendar: FireCalendarCell[];
}

function calendarQuery(filters: FireCalendarFilters) {
  const params = new URLSearchParams();
  const values: [keyof FireCalendarFilters, string][] = [
    ["startDate", "start_date"],
    ["endDate", "end_date"],
    ["west", "west"],
    ["south", "south"],
    ["east", "east"],
    ["north", "north"],
  ];

  for (const [filterKey, queryKey] of values) {
    const value = filters[filterKey].trim();
    if (value) params.set(queryKey, value);
  }

  return params;
}

async function responseError(response: Response) {
  const body = await response.text();
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "detail" in parsed &&
        typeof parsed.detail === "string"
      ) {
        return parsed.detail;
      }
    } catch {
      return body;
    }
    return body;
  }
  return `Request failed with status ${response.status}.`;
}

async function requestFireCalendar(
  filters: FireCalendarFilters,
  signal?: AbortSignal,
): Promise<FireCalendarData> {
  const query = calendarQuery(filters);
  const response = await fetch(
    `${FIRE_API_URL}/api/fire/calendar?${query.toString()}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  return response.json();
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function FireCalendar() {
  const [filters, setFilters] =
    useState<FireCalendarFilters>(EMPTY_CALENDAR_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<FireCalendarFilters>(EMPTY_CALENDAR_FILTERS);
  const [calendar, setCalendar] = useState<FireCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCalendar = useCallback(
    async (nextFilters: FireCalendarFilters, signal?: AbortSignal) => {
      if (!signal) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await requestFireCalendar(nextFilters, signal);
        if (signal?.aborted) return;
        setCalendar(result);
        setAppliedFilters(nextFilters);
      } catch (requestError) {
        if (signal?.aborted) return;
        setError(requestErrorMessage(
          requestError,
          "Unable to load fire calendar data.",
        ));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void requestFireCalendar(EMPTY_CALENDAR_FILTERS, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCalendar(result);
        setAppliedFilters(EMPTY_CALENDAR_FILTERS);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(requestErrorMessage(
          requestError,
          "Unable to load fire calendar data.",
        ));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const handleExport = () => {
    const query = calendarQuery(appliedFilters);
    const link = document.createElement("a");
    link.href = `${FIRE_API_URL}/api/fire/export.csv?${query.toString()}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const maxCount = Math.max(
    1,
    ...(calendar?.calendar ?? [])
      .filter((cell) => cell.in_range && cell.fire_count !== null)
      .map((cell) => cell.fire_count ?? 0),
  );

  const updateFilter = (key: keyof FireCalendarFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="fireCalendarCard" aria-labelledby="fireCalendarTitle">
      <div className="fireCalendarHeader">
        <div>
          <h2 id="fireCalendarTitle">Burning Activity Calendar</h2>
          <p>
            Monthly hotspot counts and anomalies against the median for the
            same month in earlier years.
          </p>
        </div>
        <button
          className="fireCalendarExport"
          type="button"
          onClick={handleExport}
          disabled={!calendar || loading}
        >
          Download filtered CSV
        </button>
      </div>

      <form
        className="fireCalendarFilters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadCalendar(filters);
        }}
      >
        <div className="fireCalendarFilterGroup">
          <label>
            Start date
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => updateFilter("startDate", event.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => updateFilter("endDate", event.target.value)}
            />
          </label>
        </div>
        <fieldset className="fireCalendarArea">
          <legend>Area bounds (optional)</legend>
          <label>
            West longitude
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              value={filters.west}
              onChange={(event) => updateFilter("west", event.target.value)}
            />
          </label>
          <label>
            South latitude
            <input
              type="number"
              min="-90"
              max="90"
              step="any"
              value={filters.south}
              onChange={(event) => updateFilter("south", event.target.value)}
            />
          </label>
          <label>
            East longitude
            <input
              type="number"
              min="-180"
              max="180"
              step="any"
              value={filters.east}
              onChange={(event) => updateFilter("east", event.target.value)}
            />
          </label>
          <label>
            North latitude
            <input
              type="number"
              min="-90"
              max="90"
              step="any"
              value={filters.north}
              onChange={(event) => updateFilter("north", event.target.value)}
            />
          </label>
        </fieldset>
        <div className="fireCalendarFilterActions">
          <button type="submit" disabled={loading}>
            {loading ? "Updating..." : "Apply filters"}
          </button>
          <span>
            Leave all area bounds empty to include detections worldwide. CSV
            export uses the last applied filters. Other dashboard charts remain
            global.
          </span>
        </div>
      </form>

      {error && (
        <p className="fireCalendarError" role="alert">
          {error}
        </p>
      )}

      {calendar && (
        <>
          <div className="fireCalendarSummary" aria-live="polite">
            <span>
              {calendar.total_detections.toLocaleString()} detections in the
              selected filters
            </span>
            {calendar.available_start_date && calendar.available_end_date && (
              <span>
                Available dataset coverage: {calendar.available_start_date} to{" "}
                {calendar.available_end_date}
              </span>
            )}
          </div>
          <div className="fireCalendarScroll">
            <div
              className="fireCalendarGrid"
              role="grid"
              aria-label="Monthly fire detections by year"
            >
              <div className="fireCalendarRow fireCalendarHeaderRow" role="row">
                <div className="fireCalendarYearLabel" role="columnheader">
                  Year
                </div>
                {MONTHS.map((month) => (
                  <div
                    className="fireCalendarMonthLabel"
                    role="columnheader"
                    key={month}
                  >
                    {month}
                  </div>
                ))}
              </div>
              {Array.from(
                new Set(calendar.calendar.map((cell) => cell.year)),
              ).map((year) => (
                <div className="fireCalendarRow" role="row" key={year}>
                  <div className="fireCalendarYearLabel" role="rowheader">
                    {year}
                  </div>
                  {MONTHS.map((monthName, index) => {
                    const cell = calendar.calendar.find(
                      (item) => item.year === year && item.month === index + 1,
                    );
                    if (!cell?.in_range || cell.fire_count === null) {
                      return (
                        <div
                          className="fireCalendarCell fireCalendarCell--empty"
                          role="gridcell"
                          aria-label={`${monthName} ${year}: outside selected date range`}
                          key={monthName}
                        />
                      );
                    }

                    const intensity = Math.min(
                      4,
                      Math.floor(
                        (Math.log1p(cell.fire_count) / Math.log1p(maxCount)) * 5,
                      ),
                    );
                    const anomalyText =
                      cell.anomaly === null
                        ? cell.complete_month
                          ? "Historical median unavailable"
                          : "Partial month; anomaly not compared"
                        : `${cell.anomaly > 0 ? "+" : ""}${cell.anomaly.toLocaleString()} vs historical median`;
                    const description = [
                      `${monthName} ${year}: ${cell.fire_count.toLocaleString()} detections`,
                      cell.historical_median === null
                        ? "No earlier-year median available"
                        : `Earlier-year median: ${cell.historical_median.toLocaleString()}`,
                      anomalyText,
                    ].join(". ");

                    return (
                      <div
                        className={`fireCalendarCell fireCalendarCell--${intensity}`}
                        role="gridcell"
                        aria-label={description}
                        title={description}
                        key={monthName}
                      >
                        <strong>{cell.fire_count.toLocaleString()}</strong>
                        <span>{anomalyText}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="fireCalendarLegend" aria-label="Detection count color scale">
            <span>Fewer detections</span>
            {[0, 1, 2, 3, 4].map((intensity) => (
              <span
                className={`fireCalendarLegendSwatch fireCalendarCell--${intensity}`}
                key={intensity}
                aria-hidden="true"
              />
            ))}
            <span>More detections</span>
          </div>
          <p className="fireCalendarNote">
            Partial months are shown but excluded from anomaly comparisons.
            Counts combine MODIS and VIIRS detections as provided; they are not
            statistically sensor-harmonized.
          </p>
        </>
      )}
    </section>
  );
}

function ChartCard({
  title,
  children,
  className,
  actions,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={className ? `fireChartCard ${className}` : "fireChartCard"}>
      {actions ? (
        <div className="fireChartCardHeader">
          <h2 className="fireChartTitle">{title}</h2>
          {actions}
        </div>
      ) : (
        <h2 className="fireChartTitle">{title}</h2>
      )}
      <div className="fireChartPlot">{children}</div>
    </section>
  );
}

export default function FireDashboard() {
  const { analytics, connected, loading, err } = useFireData("analytics");
  const [dailyZoomLevel, setDailyZoomLevel] = useState(0);
  const [hoveredSatellite, setHoveredSatellite] = useState<string | null>(null);

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

  const dailyData = analytics.frp_distribution;
  const minimumDailyRange = Math.min(7, dailyData.length);
  const maximumDailyZoomLevel =
    dailyData.length > minimumDailyRange
      ? Math.ceil(Math.log2(dailyData.length / minimumDailyRange))
      : 0;
  const activeDailyZoomLevel = Math.min(
    dailyZoomLevel,
    maximumDailyZoomLevel,
  );
  const dailyVisibleCount = Math.min(
    dailyData.length,
    Math.max(
      minimumDailyRange,
      Math.ceil(dailyData.length / 2 ** activeDailyZoomLevel),
    ),
  );
  const dailyStartIndex = Math.floor(
    (dailyData.length - dailyVisibleCount) / 2,
  );
  const visibleDailyData = dailyData.slice(
    dailyStartIndex,
    dailyStartIndex + dailyVisibleCount,
  );

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
          <article
            className="fireTemperatureCard"
            key={`${source.dataset}-${source.sensor_family}`}
          >
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

      <FireCalendar />

      <div
        className="fireChartsGrid"
        role="group"
        aria-label="Fire analytics chart gallery"
      >
        <ChartCard
          title="Daily Detections & Average FRP"
          className="fireChartCard--daily"
          actions={
            <div
              className="fireChartZoomControls"
              role="group"
              aria-label="Daily detections chart zoom controls"
            >
              <span className="fireChartZoomRange" aria-live="polite">
                {dailyData.length > 0
                  ? `Showing ${dailyStartIndex + 1}-${dailyStartIndex + visibleDailyData.length} of ${dailyData.length} days`
                  : "No daily data"}
              </span>
              <button
                type="button"
                aria-label="Zoom in on daily detections chart"
                onClick={() =>
                  setDailyZoomLevel(activeDailyZoomLevel + 1)
                }
                disabled={activeDailyZoomLevel >= maximumDailyZoomLevel}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Zoom out on daily detections chart"
                onClick={() =>
                  setDailyZoomLevel(Math.max(0, activeDailyZoomLevel - 1))
                }
                disabled={activeDailyZoomLevel === 0}
              >
                -
              </button>
              <button
                className="fireChartZoomReset"
                type="button"
                onClick={() => setDailyZoomLevel(0)}
                disabled={activeDailyZoomLevel === 0}
              >
                Reset
              </button>
            </div>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleDailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={28} />
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
                dot={false}
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

        <ChartCard
          title="Satellite Distribution"
          className="fireChartCard--satellite"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={analytics.satellite_distribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="90%"
                shape={(props) => (
                  <Sector
                    {...props}
                    outerRadius={
                      props.outerRadius +
                      (props.isActive || props.name === hoveredSatellite ? 14 : 0)
                    }
                  />
                )}
              >
                {analytics.satellite_distribution.map((_, index) => (
                  <Cell
                    key={index}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend
                onMouseEnter={(entry) => {
                  if (typeof entry.value === "string") {
                    setHoveredSatellite(entry.value);
                  }
                }}
                onMouseLeave={() => setHoveredSatellite(null)}
              />
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
                    key={`${source.dataset}-${source.sensor_family}`}
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
