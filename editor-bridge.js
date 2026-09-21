// Compiled from webtag-standard-template/src/scripts/editor-bridge.ts, bridge version 2026-09-12i
// (types stripped with esbuild, logic unchanged). Re-run the esbuild step when the bridge changes.
"use strict";
const ALLOWED_ORIGINS = [
  "https://webtag-live.vercel.app",
  // production dashboard
  "http://localhost:3020",
  // local dashboard dev
  "http://localhost:3000"
  // local dashboard dev (alt port)
];
const PREVIEW_ORIGIN = /^https:\/\/webtag-live(-[a-z0-9-]+)?(-webtagosd)?\.vercel\.app$/;
const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin);
(function initEditorBridge() {
  let mode = null;
  try {
    const params = new URLSearchParams(window.location.search);
    const iframed = window.self !== window.top;
    if (iframed && params.get("wt-edit") === "1") mode = "edit";
    else if (iframed && params.get("wt-preview") === "1") mode = "preview";
  } catch {
    mode = null;
  }
  if (!mode) return;
  const editable = mode === "edit";
  document.documentElement.setAttribute("data-wt-mode", mode);
  let activeOrigin = null;
  const post = (msg) => {
    const targets = activeOrigin ? [activeOrigin] : ALLOWED_ORIGINS;
    for (const origin of targets) {
      try {
        window.parent.postMessage(msg, origin);
      } catch {
      }
    }
  };
  const resolvePath = (obj, path) => {
    let cur = obj;
    for (const segment of path.split(".")) {
      if (cur == null) return void 0;
      cur = cur[segment];
    }
    return cur;
  };
  const applyValue = (el, value) => {
    const attr = el.getAttribute("data-wt-attr");
    const str = value == null ? "" : String(value);
    if (attr === "background") {
      el.style.backgroundImage = str ? `url("${str.replace(/"/g, '\\"')}")` : "";
      if (str) {
        el.style.backgroundSize = el.style.backgroundSize || "cover";
        el.style.backgroundPosition = el.style.backgroundPosition || "center";
      }
      return;
    }
    if (attr) {
      if (str === "") return;
      el.setAttribute(attr, str);
      if (attr === "src" && (el.tagName === "IMG" || el.tagName === "SOURCE")) {
        el.removeAttribute("srcset");
        el.removeAttribute("sizes");
      }
    } else {
      el.textContent = str;
    }
  };
  const allWtElements = () => Array.from(document.querySelectorAll("[data-wt]"));
  const cssEscape = (s) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;
  const applyContent = (content) => {
    for (const el of allWtElements()) {
      const key = el.getAttribute("data-wt");
      if (!key) continue;
      const value = resolvePath(content, key);
      if (value === void 0) continue;
      applyValue(el, value);
    }
  };
  const applyPatch = (key, value) => {
    document.querySelectorAll(`[data-wt="${cssEscape(key)}"]`).forEach((el) => applyValue(el, value));
  };
  const sectionFor = (prefix) => {
    const el = allWtElements().find((e) => {
      const key = e.getAttribute("data-wt") || "";
      return key === prefix || key.startsWith(prefix + ".");
    });
    if (!el) return null;
    return el.closest("section, header, footer, main > *, [data-wt-section]") ?? el;
  };
  const clearClass = (cls) => {
    document.querySelectorAll("." + cls).forEach((el) => el.classList.remove(cls));
  };
  const highlight = (prefix, name, scroll = true) => {
    const target = prefix === null ? null : sectionFor(prefix);
    if (prefix !== null && !target) return;
    document.querySelectorAll(".wt-section-on[data-wt-pos]").forEach((el) => {
      el.style.position = "";
      el.removeAttribute("data-wt-pos");
    });
    clearClass("wt-section-on");
    if (!target) return;
    if (getComputedStyle(target).position === "static") {
      target.style.position = "relative";
      target.setAttribute("data-wt-pos", "");
    }
    target.setAttribute("data-wt-name", name || "Editing");
    target.classList.add("wt-section-on");
    unparkFor(target);
    parkOverlays(target);
    const pos = getComputedStyle(target).position;
    if (!scroll || pos === "fixed") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduceMotion ? "auto" : "smooth";
    if (pos === "sticky") {
      let top = 0;
      let node = target;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent;
      }
      window.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      target.scrollIntoView({ block: "start", behavior });
    }
    settleRings();
  };
  const setPinning = (on) => {
    if (on) {
      document.querySelectorAll("section, header, footer, [data-wt-section]").forEach((el) => {
        if (el.hasAttribute("data-wt-unpinned") || getComputedStyle(el).position !== "sticky") return;
        el.setAttribute("data-wt-unpinned", el.style.position);
        el.style.position = "static";
      });
    } else {
      document.querySelectorAll("[data-wt-unpinned]").forEach((el) => {
        el.style.position = el.getAttribute("data-wt-unpinned") || "";
        el.removeAttribute("data-wt-unpinned");
      });
    }
  };
  const focus = (prefix) => {
    const target = prefix === null ? null : sectionFor(prefix);
    if (prefix !== null && !target) return;
    clearClass("wt-focus-on");
    document.documentElement.classList.toggle("wt-focusmode", !!target);
    setPinning(!!target);
    if (target) target.classList.add("wt-focus-on");
  };
  const outline = (key, scroll) => {
    const el = key === null ? null : document.querySelector(`[data-wt="${cssEscape(key)}"]`);
    setRing("outline", el);
    if (!el || !scroll) return;
    const r = el.getBoundingClientRect();
    if (r.top >= 64 && r.bottom <= innerHeight - 48) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    settleRings();
  };
  const ringTargets = { hover: null, selected: null, outline: null };
  let ringLayer = null;
  let ringFrame = 0;
  const ringEl = (name) => {
    if (!ringLayer) {
      ringLayer = document.createElement("div");
      ringLayer.id = "wt-rings";
      document.body.appendChild(ringLayer);
    }
    let el = document.getElementById("wt-ring-" + name);
    if (!el) {
      el = document.createElement("i");
      el.id = "wt-ring-" + name;
      ringLayer.appendChild(el);
    }
    return el;
  };
  const isShowing = (target, r) => {
    const own = sectionOf(target);
    const xs = [r.left + r.width * 0.5, r.left + r.width * 0.15, r.right - r.width * 0.15];
    const ys = [r.top + r.height * 0.5, r.top + r.height * 0.15, r.bottom - r.height * 0.15];
    for (let i = 0; i < xs.length; i++) {
      const x = Math.max(1, Math.min(innerWidth - 1, xs[i]));
      const y = Math.max(1, Math.min(innerHeight - 1, ys[i]));
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      if (hit === target || target.contains(hit) || hit.contains(target) || own.contains(hit)) return true;
    }
    return false;
  };
  const paintRings = () => {
    ringFrame = 0;
    Object.keys(ringTargets).forEach((name) => {
      const target = ringTargets[name];
      const el = ringEl(name);
      if (!target || !target.isConnected) {
        el.classList.remove("on");
        return;
      }
      const r = target.getBoundingClientRect();
      if (!r.width && !r.height) {
        el.classList.remove("on");
        return;
      }
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth || !isShowing(target, r)) {
        el.classList.remove("on");
        return;
      }
      el.style.left = r.left - 2 + "px";
      el.style.top = r.top - 2 + "px";
      el.style.width = r.width + 4 + "px";
      el.style.height = r.height + 4 + "px";
      el.classList.add("on");
    });
  };
  const queueRings = () => {
    if (!ringFrame) ringFrame = requestAnimationFrame(paintRings);
  };
  const setRing = (name, target) => {
    ringTargets[name] = target;
    paintRings();
  };
  const anyRing = () => Object.keys(ringTargets).some((k) => ringTargets[k]);
  const settleRings = () => [60, 180, 320, 500, 750].forEach((t) => setTimeout(() => anyRing() && paintRings(), t));
  addEventListener("scroll", () => {
    if (ringTargets.hover) setRing("hover", null);
    if (anyRing()) paintRings();
  }, true);
  addEventListener("resize", () => {
    if (anyRing()) paintRings();
  });
  const isBlockingOverlay = (el) => {
    const st = getComputedStyle(el);
    if (st.position !== "fixed" || st.display === "none" || st.visibility === "hidden") return false;
    if (parseFloat(st.opacity || "1") < 0.05) return false;
    const r = el.getBoundingClientRect();
    if (r.width < innerWidth * 0.6 || r.height < innerHeight * 0.6) return false;
    const total = document.querySelectorAll("[data-wt]").length;
    return !total || el.querySelectorAll("[data-wt]").length < total * 0.4;
  };
  const parkOverlays = (keep) => {
    if (!editable) return;
    Array.from(document.body.querySelectorAll("*")).forEach((el) => {
      if (el.closest("#wt-rings")) return;
      if (el.classList.contains("wt-parked")) return;
      if (keep && (el === keep || el.contains(keep))) return;
      if (isBlockingOverlay(el)) el.classList.add("wt-parked");
    });
  };
  const resolveWt = (target, x, y) => {
    const direct = target?.closest("[data-wt]");
    if (direct) return direct;
    let node = target;
    for (let hops = 0; node && hops < 4; hops++, node = node.parentElement) {
      const found = Array.from(node.querySelectorAll("[data-wt]")).find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (found) return found;
      if (node.tagName === "SECTION" || node.tagName === "BODY") break;
    }
    return null;
  };
  const unparkFor = (target) => {
    document.querySelectorAll(".wt-parked").forEach((el) => {
      if (target && (el === target || el.contains(target))) el.classList.remove("wt-parked");
    });
  };
  const sectionOf = (el) => el.closest("section, header, footer, main > *, [data-wt-section]") ?? el;
  let lastInView = null;
  const reportInView = () => {
    if (!editable) return;
    const line = innerHeight * 0.34;
    let key = null;
    for (const x of [innerWidth * 0.5, innerWidth * 0.25, innerWidth * 0.75]) {
      const el = document.elementFromPoint(x, line);
      if (!el || el.closest("#wt-rings")) continue;
      const direct = el.closest("[data-wt]");
      if (direct) {
        key = direct.getAttribute("data-wt");
        break;
      }
      const inner = sectionOf(el).querySelector("[data-wt]");
      if (inner) {
        key = inner.getAttribute("data-wt");
        break;
      }
    }
    if (!key || key === lastInView) return;
    lastInView = key;
    post({ type: "wt-inview", key });
  };
  let inViewTimer = null;
  addEventListener(
    "scroll",
    () => {
      if (inViewTimer) return;
      inViewTimer = setTimeout(() => {
        inViewTimer = null;
        reportInView();
      }, 120);
    },
    true
  );
  window.addEventListener("message", (event) => {
    try {
      if (!isAllowedOrigin(event.origin)) return;
      if (!activeOrigin) activeOrigin = event.origin;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "wt-content" && data.content && typeof data.content === "object") {
        applyContent(data.content);
      } else if (data.type === "wt-patch" && typeof data.key === "string") {
        applyPatch(data.key, data.value);
      } else if (data.type === "wt-highlight" && (data.prefix === null || typeof data.prefix === "string")) {
        highlight(data.prefix, typeof data.name === "string" ? data.name : void 0, data.scroll !== false);
      } else if (data.type === "wt-focus" && (data.prefix === null || typeof data.prefix === "string")) {
        focus(data.prefix);
      } else if (data.type === "wt-outline" && (data.key === null || typeof data.key === "string")) {
        outline(data.key, data.scroll === true);
      }
    } catch {
    }
  });
  const internalPath = (a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return null;
    try {
      const u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) return null;
      return u.pathname + u.search.replace(/[?&]wt-(edit|preview)=1/g, "");
    } catch {
      return null;
    }
  };
  if (mode === "preview") {
    document.addEventListener(
      "click",
      (e) => {
        const a = e.target?.closest("a");
        if (!a) return;
        e.preventDefault();
        const path = internalPath(a);
        if (path) {
          window.location.href = path + (path.includes("?") ? "&" : "?") + "wt-preview=1";
        }
      },
      true
    );
  }
  if (!document.getElementById("wt-bridge-css")) {
    const style = document.createElement("style");
    style.id = "wt-bridge-css";
    style.textContent = `
      [data-wt] { cursor: default; }
      .wt-section-on { outline: 3px solid #4A90E2; outline-offset: -3px; transition: outline-color .25s; }
      .wt-section-on::after { content:""; position:absolute; inset:0; pointer-events:none; background:rgba(74,144,226,.10); animation: wtflash 1.2s ease; }
      /* Corner tag naming the section, so it is obvious which block is being edited. */
      .wt-section-on::before { content: attr(data-wt-name); position:absolute; z-index:2147482000; left:0; top:0; pointer-events:none;
        background:#4A90E2; color:#fff; font:700 11px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.08em; text-transform:uppercase;
        padding:6px 10px; border-radius:0 0 8px 0; }
      @keyframes wtflash { from { background: rgba(74,144,226,.28); } }
      html.wt-focusmode section:not(.wt-focus-on), html.wt-focusmode header:not(.wt-focus-on), html.wt-focusmode footer:not(.wt-focus-on) { opacity:.28; filter:saturate(.4); transition: opacity .35s, filter .35s; }
      /* Rings live in their own fixed layer: an outline or box-shadow on the element itself is
         clipped by any overflow:hidden ancestor (e.g. a headline's reveal mask) and can be
         painted over by a later stacking context. */
      #wt-rings { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
      #wt-rings > i { position: fixed; display: none; border-radius: 5px; pointer-events: none; box-sizing: border-box; }
      #wt-rings > i.on { display: block; }
      #wt-ring-hover { border: 1px dashed rgba(30,64,175,.85); }
      #wt-ring-outline { border: 2px solid #4A90E2; box-shadow: 0 0 0 4px rgba(74,144,226,.22); }
      #wt-ring-selected { border: 2px solid #1E40AF; box-shadow: 0 0 0 4px rgba(30,64,175,.18); }
      /* A modal/popup that covers the page is parked while editing, so it can never swallow a
         click meant for the page underneath. wt-highlight on its own keys brings it back. */
      .wt-parked { display: none !important; }
    `;
    document.head.appendChild(style);
  }
  if (editable) {
    parkOverlays();
    setTimeout(parkOverlays, 400);
    setTimeout(parkOverlays, 1500);
    const pointer = (e) => e;
    document.addEventListener(
      "mouseover",
      (e) => {
        const m = pointer(e);
        setRing("hover", resolveWt(m.target, m.clientX, m.clientY));
      },
      true
    );
    const INTERACTIVE = "a, button, [role='button'], input, select, textarea, label, summary, [onclick]";
    const swallow = (e) => {
      const t = e.target;
      if (t?.closest(INTERACTIVE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("mousedown", swallow, true);
    document.addEventListener("auxclick", swallow, true);
    document.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
    document.addEventListener("keydown", (e) => {
      const k = e.key;
      if ((k === "Enter" || k === " ") && e.target?.closest(INTERACTIVE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    document.addEventListener(
      "click",
      (e) => {
        const m = pointer(e);
        const t = m.target;
        const target = resolveWt(t, m.clientX, m.clientY);
        e.preventDefault();
        if (t?.closest(INTERACTIVE) || target) e.stopPropagation();
        if (!target) return;
        const key = target.getAttribute("data-wt");
        if (!key) return;
        setRing("selected", target);
        const sectionKey = sectionOf(target).querySelector("[data-wt]")?.getAttribute("data-wt") ?? null;
        post({ type: "wt-select", key, sectionKey });
      },
      true
    );
  }
  const ready = () => {
    try {
      const keys = Array.from(
        new Set(allWtElements().map((el) => el.getAttribute("data-wt")).filter((k) => !!k))
      );
      const sections = Array.from(new Set(keys.map((k) => k.split(".")[0])));
      post({ type: "wt-ready", keys, sections });
    } catch {
    }
  };
  if (document.readyState === "complete" || document.readyState === "interactive") {
    ready();
  } else {
    document.addEventListener("DOMContentLoaded", ready);
  }
})();
