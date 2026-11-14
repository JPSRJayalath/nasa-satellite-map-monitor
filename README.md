This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Fire dataset files

Put compatible fire-monitoring `.csv` files in `server/datasets/`. The backend automatically discovers every CSV in that folder and reloads on the next data request after files are added, removed, or changed; dataset filenames do not need to be added to the code. Refresh the browser to request the updated data.

Each file must include `latitude`, `longitude`, `acq_date`, `acq_time`, and `frp`, plus both brightness channels using either `bright_ti4`/`bright_ti5` or `brightness`/`bright_t31`. Headers are case- and whitespace-insensitive. Instrument and satellite columns are used to identify MODIS or VIIRS when available. Files missing required columns are reported instead of silently skipped.

All valid records contribute to analytics and are represented at their exact coordinates on the map. Map requests return every matching detection in the current viewport without a 50,000-record cap; dots are blue for MODIS and orange for VIIRS. The map is mounted only when opened, and the backend stops generating points when a viewport request is canceled. The location list continues to use a repeatable sample of up to 50,000 records and shows 200 entries at a time. The paginated `/api/fire/data` endpoint can retrieve the full dataset.

## Burning activity calendar

The analytics dashboard includes a monthly-by-year hotspot calendar. Start/end dates filter the calendar and CSV export. Optional west/south/east/north coordinates restrict both to a bounding box; leave all four empty for global results. All four bounds must be provided together, and boxes crossing the antimeridian are not supported. The existing summary cards and charts remain global.

Each complete calendar month is compared with the median detection count for the same month in earlier complete years. Partial months remain visible but have no anomaly comparison. The API reports the actual available dataset date range; it does not fabricate earlier observations. `/api/fire/calendar` returns the monthly counts and comparisons, and `/api/fire/export.csv` streams the matching raw rows.

MODIS and VIIRS detections are currently combined as supplied, not statistically sensor-harmonized. Their differing resolution, sensitivity, and observation schedules still require a validated harmonization method before counts can be interpreted as a sensor-independent time series.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
