// Stamps the service worker in a built site with a release version and the
// complete list of app files, so the precache always matches what ships.
// Usage: node scripts/stamp-sw.mjs <site-dir> <version>
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const [site, version] = process.argv.slice(2);
if (!site || !version) { console.error("usage: stamp-sw.mjs <site-dir> <version>"); process.exit(1); }

// Not precached: the worker itself, the single-file offline edition (a
// separate download that duplicates everything), the 404 page and the social
// preview image (neither is used offline).
const SKIP = new Set(["sw.js", "flame-in-freefall-offline.html", "404.html", "assets/social.png"]);

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(relative(site, p).split(sep).join("/"));
  }
  return out;
}

const files = (await walk(site)).filter((f) => !SKIP.has(f) && !f.startsWith(".") && !f.endsWith(".txt")).sort();   // license texts are not needed offline
const shell = ["./", ...files];
const swPath = join(site, "sw.js");
let sw = await readFile(swPath, "utf8");
const VERSION_RE = /const VERSION = "[^"]*";/, SHELL_RE = /const SHELL = \[[\s\S]*?\];/;
if (!VERSION_RE.test(sw) || !SHELL_RE.test(sw)) { console.error("stamp-sw: VERSION or SHELL marker not found in sw.js"); process.exit(1); }
sw = sw.replace(VERSION_RE, `const VERSION = ${JSON.stringify(version)};`).replace(SHELL_RE, `const SHELL = ${JSON.stringify(shell)};`);
await writeFile(swPath, sw);
console.log(`sw.js stamped: ${version}, ${shell.length} files`);
