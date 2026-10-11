import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Re-vendors Shoelace into packages/ui-kit/vendor/shoelace (the single copy
// every app serves at <base>/ui/vendor/shoelace). Run from the repo root:
//   npm run vendor:shoelace

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");
const SHOELACE = path.join(REPO_ROOT, "node_modules", "@shoelace-style", "shoelace", "dist");
const OUT = path.join(here, "..", "vendor", "shoelace");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build({
  entryPoints: [`${SHOELACE}/shoelace.js`],
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outdir: OUT,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "warning",
});

await cp(`${SHOELACE}/themes/light.css`, `${OUT}/theme-light.css`);
await cp(`${SHOELACE}/themes/dark.css`, `${OUT}/theme-dark.css`);

console.log(`Vendored Shoelace into ${OUT}`);
