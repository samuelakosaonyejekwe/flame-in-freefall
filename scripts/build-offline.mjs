// Builds the single-file offline edition: one HTML file with every script,
// style, font, icon and the latest NASA report snapshot inlined. It opens from
// a phone or laptop with no network at all (double-click / open in browser).
// Usage: node scripts/build-offline.mjs <site-dir>
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const site = process.argv[2];
if (!site) { console.error("usage: build-offline.mjs <site-dir>"); process.exit(1); }
const read = (p, enc = "utf8") => readFile(join(site, p), enc);
const sha = (s) => "'sha256-" + createHash("sha256").update(s, "utf8").digest("base64") + "'";
// Inline script bodies must not close their own tag.
const safe = (js) => js.replace(/<\/script/gi, "<\\/script");

let html = await read("index.html");
const scripts = [];
const take = (body) => { scripts.push(body); return body; };

// Styles with fonts embedded as data URIs.
let css = await read("assets/styles.css");
const fontRefs = [...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map((m) => m[1]);
for (const ref of new Set(fontRefs)) {
  const b64 = (await read("assets/" + ref, null)).toString("base64");
  css = css.split(`url(${ref})`).join(`url(data:font/woff2;base64,${b64})`);
}
html = html.replace(/<link rel="stylesheet" href="assets\/styles\.css">/, () => `<style>${css}</style>`);

// Icons as data URIs; no manifest (a file cannot be installed as a web app).
const iconSvg = "data:image/svg+xml;base64," + (await read("assets/icon.svg", null)).toString("base64");
const iconPng = "data:image/png;base64," + (await read("assets/icon-180.png", null)).toString("base64");
html = html.replace(/<link rel="manifest"[^>]*>\n?/, "");
html = html.replace(/<link rel="preload"[^>]*>\n?/g, "");   // fonts are embedded below
html = html.replace(/(<link rel="icon" href=")[^"]*(")/, `$1${iconSvg}$2`);
html = html.replace(/(<link rel="apple-touch-icon" href=")[^"]*(")/, `$1${iconPng}$2`);

// Scripts, in their original order, plus the embedded report snapshot.
const snapshot = JSON.parse(await read("live/ntrs.json"));
const flag = safe(`window.FF_OFFLINE_EDITION = true; window.FF_SNAPSHOT = ${JSON.stringify({ ntrs: snapshot, builtAt: new Date().toISOString() })};`);
const theme = safe(await read("assets/theme.js"));
html = html.replace(/<script src="assets\/theme\.js"><\/script>/, () => `<script>${take(flag)}</script>\n<script>${take(theme)}</script>`);
for (const name of ["data", "engine", "charts", "live", "app"]) {
  const body = safe(await read(`assets/${name}.js`));
  html = html.replace(new RegExp(`<script src="assets/${name}\\.js" defer></script>`), () => `<script>${take(body)}</script>`);
}
if (/<script src="assets\//.test(html) || /href="assets\//.test(html)) { console.error("build-offline: unresolved asset reference left in HTML"); process.exit(1); }

// A CSP that allows exactly these inline scripts, by hash.
const csp = [
  "default-src 'none'",
  `script-src ${scripts.map(sha).join(" ")} https://cdn.jsdelivr.net`,
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src data: https://images-assets.nasa.gov",
  "connect-src https://api.openalex.org https://images-api.nasa.gov https://api.anthropic.com https://cdn.jsdelivr.net",
  "base-uri 'none'", "form-action 'none'", "object-src 'none'"
].join("; ");
html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

await writeFile(join(site, "flame-in-freefall-offline.html"), html);
console.log(`offline edition: ${(html.length / 1024).toFixed(0)} KB, ${scripts.length} inline scripts`);
