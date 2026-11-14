import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(
  projectRoot,
  "node_modules/maplibre-gl/dist",
);
const publicDirectory = resolve(projectRoot, "public");

for (const filename of [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-worker.mjs.map",
]) {
  copyFileSync(
    resolve(sourceDirectory, filename),
    resolve(publicDirectory, filename),
  );
}
