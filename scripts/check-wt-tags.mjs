// Sanity check for the data-wt live-canvas bindings baked into the built site.
// Run after `npm run build` (walks dist/**/*.html, builds nothing itself). Exits non-zero on failure.
// Ported from webtag-restaurant-template/scripts/check-wt-tags.mjs; validates data-wt keys
// against content/content.json in both directions:
//   1. forward: every data-wt="<key>" in any page resolves to a real path in content.json.
//   2. reverse: every non-empty leaf in content.json is bound by a data-wt somewhere,
//      except the EXEMPT keys below (each says why).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist");
const content = JSON.parse(readFileSync(join(root, "content", "content.json"), "utf8"));

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkHtmlFiles(p));
    else if (entry.endsWith(".html")) out.push(p);
  }
  return out;
}

// Every dot-joined leaf path in content.json, arrays walked by index (list.0.field).
function collectLeafPaths(obj, prefix = "") {
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) => collectLeafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [{ path: prefix, value: obj }];
}

const getAtPath = (obj, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), obj);

let htmlFiles;
try {
  htmlFiles = walkHtmlFiles(distDir);
} catch (e) {
  console.error(`check-wt-tags: could not read ${distDir}, did you run \`npm run build\` first?`);
  console.error(e.message);
  process.exit(1);
}
if (htmlFiles.length === 0) {
  console.error(`check-wt-tags: no .html files found under ${distDir}`);
  process.exit(1);
}

// seo.* is <head> meta (index title + description, set by the build); site.* is site config
// (site.tagline is still bound in every footer).
const EXEMPT_PREFIXES = ["site.", "seo."];
const EXEMPT_KEYS = new Set([
  // The home headline's last words sit in an italic rust <span>; a plain-text bind would wipe
  // that styling in the canvas. The build renders it from content.json (data-cms-headline).
  "hero.headline",
  // One value spread over differently styled paragraphs (display lead + body / three body
  // paragraphs). The build splits it by sentence into them (data-cms-split).
  "process.intro",
  "about.whoBody",
]);
const EXEMPT_RE = [];

const foundKeys = new Set();
let totalWtAttrs = 0;
let totalWtAttrSrc = 0;

for (const file of htmlFiles) {
  // Strip <script> bodies: the bridge's own selector code contains data-wt="${...}".
  const html = readFileSync(file, "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const matches = html.match(/data-wt="([^"]*)"/g) ?? [];
  totalWtAttrs += matches.length;
  totalWtAttrSrc += (html.match(/data-wt-attr="src"/g) ?? []).length;
  for (const m of matches) {
    const key = m.slice('data-wt="'.length, -1);
    if (key) foundKeys.add(key);
  }
}
const bridgeLoaded = htmlFiles.every((f) => readFileSync(f, "utf8").includes('src="/editor-bridge.js"'));

const orphanKeys = [...foundKeys].filter((key) => getAtPath(content, key) === undefined);

const unboundLeaves = collectLeafPaths(content)
  .filter(({ path, value }) =>
    !EXEMPT_PREFIXES.some((p) => path.startsWith(p)) &&
    !EXEMPT_KEYS.has(path) &&
    !EXEMPT_RE.some((re) => re.test(path)) &&
    value !== "" && value !== null &&
    !foundKeys.has(path))
  .map(({ path }) => path);

const checks = [
  ["every page loads /editor-bridge.js", bridgeLoaded, null],
  ["includes an indexed list key", [...foundKeys].some((k) => /\.\d+\./.test(k)), null],
  ['includes a data-wt-attr="src" binding', totalWtAttrSrc > 0, `found ${totalWtAttrSrc}`],
  ["no orphan data-wt keys (forward)", orphanKeys.length === 0, orphanKeys.slice(0, 20).join(", ") || null],
  ["no unbound content leaves (reverse)", unboundLeaves.length === 0, unboundLeaves.slice(0, 20).join(", ") || null],
];

let failed = false;
console.log(`Scanned ${htmlFiles.length} page(s) under dist/: ${htmlFiles.map((f) => relative(distDir, f)).join(", ")} (${totalWtAttrs} data-wt attrs, ${foundKeys.size} keys)`);
for (const [label, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!pass) failed = true;
}
if (failed) {
  console.error("\ncheck-wt-tags: FAILED");
  process.exit(1);
}
console.log("\ncheck-wt-tags: all checks passed");
