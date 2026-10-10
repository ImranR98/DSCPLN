import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const SHOELACE = "node_modules/@shoelace-style/shoelace/dist";
const OUT = "static/vendor/shoelace";

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
