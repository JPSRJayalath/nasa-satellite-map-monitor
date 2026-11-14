# NASA Fire Monitor

A fire-monitoring application with a Next.js web interface and a FastAPI backend. **Run both services during development**: the Next.js app does not start the Python backend for you.

## Requirements

- Node.js 20.9 or later and npm
- Python 3.11 or later and pip

## Install

If you have not already cloned the project:

```bash
git clone https://github.com/JPSRJayalath/nasa-satellite-map-monitor.git
cd nasa-satellite-map-monitor
```

### Install backend dependencies

In a terminal, create and activate a Python virtual environment from the `server` directory:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install fastapi "uvicorn[standard]" pandas numpy
```

On Windows PowerShell, create and activate the environment with:

```powershell
cd server
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Then run the two `python -m pip` install commands above.

### Install frontend dependencies

Open a **second terminal** in the project root (the directory containing `package.json`) and install the locked npm dependencies:

```bash
npm ci
```

The `postinstall` script copies `maplibre-gl-worker.mjs` and its source map from `node_modules/maplibre-gl/dist/` into `public/`. To repeat the copy manually after changing the MapLibre version, run this from the project root:

```bash
npm run copy:maplibre-worker
```

## Start the application

Keep both terminals running.

**Terminal 1 — backend:** from the `server` directory, activate the virtual environment if needed, then start FastAPI:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 9000
```

The backend should report that it is listening on port `9000`. Its interactive API documentation is available at [http://localhost:9000/docs](http://localhost:9000/docs).

**Terminal 2 — web app:** from the project root:

```bash
npm run dev
```

Open the URL printed by Next.js, normally [http://localhost:3000](http://localhost:3000). If port `3000` is busy, Next.js may use `3001`; both local ports are allowed by the backend's CORS configuration.

The frontend calls the backend at `http://localhost:9000`, so use the web app and backend on the same computer. The `0.0.0.0` host setting is for local development and listens on all network interfaces; do not expose this development server to an untrusted network.

## Fire dataset files

Place fire-monitoring CSV files in `server/datasets/`. The backend automatically discovers CSV files in that folder and reloads them on a data request after a file is added, removed, or changed. Refresh the browser to request updated data.

Each CSV must include:

- `latitude`, `longitude`, `acq_date`, `acq_time`, and `frp`
- A brightness channel named `bright_ti4` or `brightness`
- A second brightness channel named `bright_ti5` or `bright_t31`

Column names are case- and whitespace-insensitive. When available, `instrument` and `satellite` values are used to identify MODIS or VIIRS. Files with missing required columns are reported as errors.

All valid records contribute to analytics. The map displays matching detections at their exact coordinates in the current viewport, with MODIS and VIIRS shown in different colors. The location list uses a repeatable sample of up to 50,000 records and displays 200 entries at a time; the paginated `/api/fire/data` endpoint can retrieve the full dataset.

## Burning activity calendar

The analytics dashboard includes a month-by-year hotspot calendar. Start and end dates filter the calendar and CSV export. Optional west, south, east, and north coordinates restrict both to a bounding box; provide all four bounds together. Boxes crossing the antimeridian are not supported. Summary cards and charts remain global.

Complete calendar months are compared with the median detection count for the same month in earlier complete years. Partial months are shown without an anomaly comparison. The API reports the actual date range available in the CSV files; it does not fabricate earlier observations.

MODIS and VIIRS detections are combined as supplied and are **not currently statistically harmonized**. Their differing resolution, sensitivity, and observation schedules must be addressed with a validated method before interpreting counts as a sensor-independent time series.

## Backend endpoints

- `GET /` — backend status
- `GET /api/fire/analytics` — summary analytics
- `GET /api/fire/map` — detections in the requested map viewport
- `GET /api/fire/data` — paginated fire records
- `GET /api/fire/calendar` — calendar counts and historical comparisons
- `GET /api/fire/export.csv` — download filtered detections as CSV
- `WS /ws` — backend status updates

## Troubleshooting

- **The app shows “Disconnected” or cannot load fire data:** make sure the Uvicorn terminal is still running on port `9000` and the browser opened the Next.js URL on `localhost` or `127.0.0.1`.
- **The map or charts show no detections:** confirm that valid CSV files are in `server/datasets/` and that their headers include all required columns.
- **The frontend uses a different port:** the backend currently allows local origins on ports `3000` and `3001`; update the CORS origins in `server/main.py` if you intentionally use another port.
