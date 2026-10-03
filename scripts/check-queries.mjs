// Build guard: the browser's direct-request fallbacks (assets/live.js) must
// ask exactly what the relay and the build ask (relay/sources.mjs).
import { readFile } from "node:fs/promises";
import { QUERIES, NASA_OPENALEX, NASA_FUNDER } from "../relay/sources.mjs";

const src = await readFile(new URL("../assets/live.js", import.meta.url), "utf8");
const arr = (name) => {
  const m = src.match(new RegExp(`var ${name} = (\\[[\\s\\S]*?\\]);`));
  if (!m) throw new Error(`${name} not found in assets/live.js`);
  return JSON.parse(m[1]);
};
const problems = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!same(arr("OA_QUERIES"), QUERIES.openalex)) problems.push("OpenAlex queries differ");
if (!same(arr("CR_QUERIES"), QUERIES.crossref)) problems.push("Crossref queries differ");
if (!src.includes(`NASA_OPENALEX = "${NASA_OPENALEX}"`)) problems.push("OpenAlex institution id differs");
if (!src.includes(`NASA_FUNDER = "${NASA_FUNDER}"`)) problems.push("Crossref funder id differs");
if (problems.length) { console.error("check-queries: " + problems.join("; ")); process.exit(1); }
console.log("check-queries: browser fallbacks match relay/sources.mjs");
