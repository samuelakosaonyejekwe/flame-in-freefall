// Stamps the service worker in a built site with a release version and the
// complete list of app files, so the precache always matches what ships.
// Usage: node scripts/stamp-sw.mjs <site-dir> <version>
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const [site, version] = process.argv.slice(2);
if (!site || !version) { console.error("usage: stamp-sw.mjs <site-dir> <version>"); process.exit(1); }

// Not precached: the worker itself and the single-file offline edition (a
// separate download that duplicates everything).
const SKIP = new Set(["sw.js", "flame-in-freefall-offline.html"]);

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(relative(site, p).split(sep).join("/"));
  }
  return out;
}

const files = (await walk(site)).filter((f) => !SKIP.has(f) && !f.startsWith(".")).sort();
const shell = ["./", ...files];
const swPath = join(site, "sw.js");
let sw = await readFile(swPath, "utf8");
const before = sw;
sw = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = ${JSON.stringify(version)};`);
sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell)};`);
if (sw === before || !sw.includes(version)) { console.error("stamp-sw: markers not found in sw.js"); process.exit(1); }
await writeFile(swPath, sw);
console.log(`sw.js stamped: ${version}, ${shell.length} files`);
