// Copies the static site into dist/ with content/content.json baked into every page, so a
// dashboard Publish (which commits content.json) ships on the next Vercel build. The .html
// files keep their literal copy, so they still work opened raw.
// Based on kiwiquote/scripts/build.mjs, extended to every *.html page in the repo root.
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, readdirSync, existsSync } from "node:fs";
import { parseHTML } from "linkedom";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const content = JSON.parse(read("content/content.json"));

// Same dot-path resolution as the editor bridge (numeric segments index arrays).
const get = (path) => path.split(".").reduce((cur, seg) => (cur == null ? undefined : cur[seg]), content);
const text = (path) => {
  const value = get(path);
  if (value === undefined || (value !== null && typeof value === "object")) {
    throw new Error(`content.json has no text value for "${path}"`);
  }
  return value == null ? "" : String(value);
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ponytail: list items are the repeats already in the HTML (stats 4, services 3, reviews 3,
// features 6, steps 6, projects 4), so lists can't grow past those counts. A removed item
// fails the build here instead of shipping stale copy.
function renderPage(file) {
  const { document } = parseHTML(read(file));

  for (const el of document.querySelectorAll("[data-wt]")) {
    const str = text(el.getAttribute("data-wt"));
    const attr = el.getAttribute("data-wt-attr");
    if (attr === "background") {
      if (str) el.setAttribute("style", [el.getAttribute("style"), `background-image:url("${str.replace(/"/g, '\\"')}")`, "background-size:cover", "background-position:center"].filter(Boolean).join(";"));
    } else if (attr) {
      if (str) el.setAttribute(attr, str); // empty means "keep what's there", same as the bridge
    } else {
      el.textContent = str;
    }
  }

  // Build-only bindings the canvas can't live-edit (they need markup around the value).
  if (file === "index.html") {
    document.title = text("seo.title");
    document.querySelector('meta[name="description"]').setAttribute("content", text("seo.description"));
  }

  // ponytail: the italic rust tail of the home headline is its last three words, matching
  // the original "brought<span> back to life.</span>". Upgrade path: a hero.highlight key.
  for (const h1 of document.querySelectorAll("[data-cms-headline]")) {
    const words = text(h1.getAttribute("data-cms-headline")).split(" ");
    const tail = words.splice(Math.max(words.length - 3, 1));
    const span = h1.querySelector("span");
    h1.innerHTML = `${esc(words.join(" "))}<span class="${span.getAttribute("class")}"> ${esc(tail.join(" "))}</span>`;
  }

  // One long value spread over several styled paragraphs: one sentence per element, the
  // last element takes whatever is left.
  const splits = new Map();
  for (const el of document.querySelectorAll("[data-cms-split]")) {
    const key = el.getAttribute("data-cms-split");
    splits.set(key, [...(splits.get(key) ?? []), el]);
  }
  for (const [key, els] of splits) {
    const sentences = text(key).split(/(?<=[.!?])\s+/);
    els.forEach((el, i) => {
      el.textContent = i < els.length - 1 ? sentences[i] ?? "" : sentences.slice(i).join(" ");
    });
  }

  for (const el of document.querySelectorAll("[data-cms-initial]")) {
    el.textContent = text(el.getAttribute("data-cms-initial")).charAt(0);
  }

  // tel:/mailto: are built from the value, never attr-bound (see BRIEF).
  for (const a of document.querySelectorAll("[data-cms-tel]")) {
    a.setAttribute("href", `tel:${text(a.getAttribute("data-cms-tel")).replace(/\s+/g, "")}`);
  }
  for (const a of document.querySelectorAll("[data-cms-mailto]")) {
    a.setAttribute("href", `mailto:${text(a.getAttribute("data-cms-mailto"))}`);
  }

  const bridge = document.createElement("script");
  bridge.setAttribute("src", "/editor-bridge.js");
  bridge.setAttribute("defer", "");
  document.head.appendChild(bridge);

  return document.toString();
}

const pages = readdirSync(root).filter((f) => f.endsWith(".html"));
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
cpSync(new URL("assets/", root), new URL("assets/", dist), { recursive: true });
cpSync(new URL("editor-bridge.js", root), new URL("editor-bridge.js", dist));
// robots.txt is served from the site root, so it has to be copied like any other asset.
// Without this the file sits in the repo and 404s on the live site.
if (existsSync(new URL("robots.txt", root))) cpSync(new URL("robots.txt", root), new URL("robots.txt", dist));
for (const file of pages) writeFileSync(new URL(file, dist), renderPage(file));
console.log(`built ${pages.length} pages into dist/: ${pages.join(", ")}`);
