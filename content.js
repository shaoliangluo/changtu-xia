(() => {
  // Re-inject after extension refresh must replace the old handlers.
  // Keep a single message listener; swap the API object each time.
  const prev = globalThis.__JIETU_API__;
  if (prev?.teardown) {
    try {
      prev.teardown();
    } catch {
      /* ignore stale cleanup failures */
    }
  }

  const state = {
    mode: "window",
    target: null,
    fixed: [],
    backgrounds: [],
    fixedHidden: false,
    styleEl: null,
    host: null,
    ui: null,
    onKey: null,
    onAction: null,
    saved: null,
    pickResolve: null,
    pickCleanup: null,
  };

  async function handle(message) {
    if (message.type === "pick") return pick();
    if (message.type === "abort") {
      finishPick({ captureMode: "cancel", ...pageInfo() });
      return { captureMode: "cancel" };
    }
    if (message.type === "prepare") return prepare();
    if (message.type === "status") return status(message);
    if (message.type === "frame") return frame(message);
    if (message.type === "toast") return status({ title: message.message, detail: "", progress: 1 });
    if (message.type === "fail") return fail(message.message);
    if (message.type === "restore") {
      restore();
      return {};
    }
    throw new Error("未知指令");
  }

  const api = {
    version: 2,
    handle,
    teardown() {
      try {
        finishPick({ captureMode: "cancel", ...pageInfo() });
      } catch {
        restore();
      }
      document.querySelectorAll("[data-jietu]").forEach((el) => el.remove());
    },
  };
  globalThis.__JIETU_API__ = api;
  globalThis.__JIETU_CHANGTU__ = true;

  if (!globalThis.__JIETU_LISTENER__) {
    globalThis.__JIETU_LISTENER__ = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.source !== "jietu") return;
      const current = globalThis.__JIETU_API__;
      if (!current?.handle) return;
      current
        .handle(message)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    });
  }

  function pick() {
    abortPick();
    restore();
    return new Promise((resolve) => {
      state.pickResolve = resolve;
      buildPicker();
    });
  }

  function finishPick(result) {
    const resolve = state.pickResolve;
    state.pickResolve = null;
    restore();
    if (resolve) resolve(result);
  }

  function abortPick() {
    state.pickCleanup?.();
    state.pickCleanup = null;
  }

  function pageInfo() {
    return {
      title: document.title,
      href: location.href,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    };
  }

  function buildPicker() {
    const host = document.createElement("div");
    host.setAttribute("data-jietu", "");
    for (const [key, value] of Object.entries({
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      overflow: "hidden",
      "z-index": "2147483647",
      display: "block",
      "pointer-events": "auto",
    })) {
      host.style.setProperty(key, value, "important");
    }
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; inset: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
        .veil { position: absolute; inset: 0; background: rgba(18, 24, 20, 0.28); }
        .dock {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          width: min(420px, calc(100vw - 24px));
          box-sizing: border-box;
          padding: 14px;
          border-radius: 14px;
          background: #fffdf8;
          color: #1c2420;
          box-shadow: 0 16px 40px rgba(20, 24, 20, 0.22);
        }
        strong { display: block; font-size: 15px; font-weight: 650; }
        p { margin: 4px 0 12px; color: #5d675f; font-size: 13px; line-height: 1.5; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; }
        button {
          border: 1px solid #e4dccb;
          background: #fffdf8;
          color: #1c2420;
          font: inherit;
          font-size: 13px;
          border-radius: 999px;
          padding: 8px 12px;
          cursor: pointer;
        }
        button.primary { background: #0e7c66; border-color: #0e7c66; color: #fff; }
        button.ghost { background: transparent; }
        .layer { position: absolute; inset: 0; cursor: crosshair; }
        .box {
          position: absolute;
          border: 2px solid #0e7c66;
          box-shadow: 0 0 0 9999px rgba(18, 24, 20, 0.45);
          pointer-events: none;
        }
        .size {
          position: absolute;
          left: 0;
          top: -26px;
          background: #0e7c66;
          color: #fff;
          font-size: 12px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .layer[hidden], .box[hidden] { display: none; }
      </style>
      <div class="wrap">
        <div class="veil"></div>
        <div class="dock">
          <strong>怎么截？</strong>
          <p>不想要整页长图时，可以只截当前屏幕，或自己拖出一块范围。</p>
          <div class="actions">
            <button type="button" class="primary" data-mode="full">整页长图</button>
            <button type="button" data-mode="visible">当前屏幕</button>
            <button type="button" data-mode="region">框选范围</button>
            <button type="button" class="ghost" data-mode="cancel">取消</button>
          </div>
        </div>
        <div class="layer" hidden>
          <div class="box" hidden><span class="size"></span></div>
        </div>
      </div>
    `;
    const dock = shadow.querySelector(".dock");
    const title = shadow.querySelector("strong");
    const detail = shadow.querySelector("p");
    const layer = shadow.querySelector(".layer");
    const box = shadow.querySelector(".box");
    const sizeEl = shadow.querySelector(".size");
    let start = null;
    let rect = null;
    let selecting = false;

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (selecting) {
        selecting = false;
        layer.hidden = true;
        box.hidden = true;
        dock.hidden = false;
        title.textContent = "怎么截？";
        detail.textContent = "不想要整页长图时，可以只截当前屏幕，或自己拖出一块范围。";
        return;
      }
      finishPick({ captureMode: "cancel", ...pageInfo() });
    };

    shadow.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mode = button.getAttribute("data-mode");
        if (mode === "cancel") {
          finishPick({ captureMode: "cancel", ...pageInfo() });
          return;
        }
        if (mode === "full" || mode === "visible") {
          finishPick({ captureMode: mode, ...pageInfo() });
          return;
        }
        selecting = true;
        rect = null;
        dock.hidden = true;
        layer.hidden = false;
        box.hidden = true;
      });
    });

    const pos = (event) => ({
      x: Math.min(window.innerWidth, Math.max(0, event.clientX)),
      y: Math.min(window.innerHeight, Math.max(0, event.clientY)),
    });

    const applyRect = (a, b) => {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      rect = { x, y, w, h };
      box.hidden = w < 2 && h < 2;
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      sizeEl.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    };

    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      start = pos(event);
      applyRect(start, start);
    });
    layer.addEventListener("pointermove", (event) => {
      if (!start) return;
      applyRect(start, pos(event));
    });
    layer.addEventListener("pointerup", (event) => {
      if (!start) return;
      applyRect(start, pos(event));
      start = null;
      if (!rect || rect.w < 8 || rect.h < 8) {
        box.hidden = true;
        return;
      }
      finishPick({ captureMode: "region", rect, ...pageInfo() });
    });

    document.addEventListener("keydown", onKey, true);
    state.pickCleanup = () => document.removeEventListener("keydown", onKey, true);
    document.documentElement.append(host);
    state.host = host;
  }

  async function prepare() {
    restore();
    state.saved = {
      x: window.scrollX,
      y: window.scrollY,
      pointer: document.documentElement.style.pointerEvents,
    };
    state.styleEl = document.createElement("style");
    state.styleEl.setAttribute("data-jietu", "");
    state.styleEl.textContent = `
      html, body { scroll-behavior: auto !important; }
      html { scrollbar-width: none !important; }
      ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      * { scroll-behavior: auto !important; scroll-snap-type: none !important; animation-play-state: paused !important; transition: none !important; }
    `;
    document.documentElement.append(state.styleEl);
    document.documentElement.style.pointerEvents = "none";
    buildOverlay();
    await frames(2);
    const found = detectTarget();
    state.mode = found.mode;
    state.target = found.target;
    if (state.mode === "element") {
      state.saved.targetTop = state.target.scrollTop;
      state.saved.targetLeft = state.target.scrollLeft;
    }
    retargetFixedBackgrounds();
    const metrics = measure();
    return {
      ...metrics,
      title: document.title,
      href: location.href,
    };
  }

  function detectTarget() {
    const doc = document.documentElement;
    const body = document.body;
    const pageHeight = Math.max(doc.scrollHeight, body?.scrollHeight || 0);
    const pageWidth = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
    const docScrolls = pageHeight > window.innerHeight + 40 || pageWidth > window.innerWidth + 40;
    if (docScrolls) return { mode: "window", target: null };

    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement) || el.hasAttribute("data-jietu")) continue;
      if (el.scrollHeight <= el.clientHeight + 40 && el.scrollWidth <= el.clientWidth + 40) continue;
      if (el.clientHeight < 80 || el.clientWidth < 80) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
      const rect = el.getBoundingClientRect();
      const fullyVisible = rect.top >= -2 && rect.left >= -2 && rect.bottom <= window.innerHeight + 2 && rect.right <= window.innerWidth + 2;
      if (!fullyVisible) continue;
      const area = el.clientWidth * el.scrollHeight;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best ? { mode: "element", target: best } : { mode: "window", target: null };
  }

  function measure() {
    if (state.mode === "element" && state.target) {
      const rect = contentRect(state.target);
      return {
        mode: "element",
        pageWidth: state.target.scrollWidth,
        pageHeight: state.target.scrollHeight,
        viewportWidth: state.target.clientWidth,
        viewportHeight: state.target.clientHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        rect,
      };
    }
    const doc = document.documentElement;
    const body = document.body;
    return {
      mode: "window",
      pageWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0, doc.clientWidth),
      pageHeight: Math.max(doc.scrollHeight, body?.scrollHeight || 0, doc.clientHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      rect: null,
    };
  }

  function contentRect(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const left = rect.left + (parseFloat(style.borderLeftWidth) || 0);
    const top = rect.top + (parseFloat(style.borderTopWidth) || 0);
    return { x: left, y: top, w: el.clientWidth, h: el.clientHeight };
  }

  async function frame(message) {
    if (message.hideFixed) hideFixed();
    else showFixed();
    scrollToPosition(message.x, message.y);
    if (message.first && document.fonts?.ready) {
      await Promise.race([document.fonts.ready, sleep(800)]);
    }
    await settle(message.first ? 160 : 100);
    hideOverlay();
    await frames(2);
    await sleep(70);
    const position = currentScroll();
    return {
      ...measure(),
      actualX: position.x,
      actualY: position.y,
    };
  }

  function scrollToPosition(x, y) {
    if (state.mode === "element" && state.target) {
      state.target.scrollLeft = x;
      state.target.scrollTop = y;
      return;
    }
    window.scrollTo(x, y);
  }

  function currentScroll() {
    if (state.mode === "element" && state.target) {
      return { x: state.target.scrollLeft, y: state.target.scrollTop };
    }
    return { x: window.scrollX, y: window.scrollY };
  }

  async function settle(ms) {
    await frames(2);
    const images = pendingImages();
    if (images.length) {
      await Promise.race([
        Promise.all(images.map(waitImage)),
        sleep(600),
      ]);
    }
    await sleep(ms);
    await frames(1);
  }

  function pendingImages() {
    const view = state.mode === "element" && state.target ? state.target.getBoundingClientRect() : null;
    const list = [];
    for (const img of document.images) {
      if (img.complete) continue;
      const rect = img.getBoundingClientRect();
      const bounds = view || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const visible = rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
      if (visible) list.push(img);
    }
    return list;
  }

  function waitImage(img) {
    return new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }

  function showFixed() {
    for (const [el, visibility] of state.fixed) {
      if (visibility) el.style.setProperty("visibility", visibility);
      else el.style.removeProperty("visibility");
    }
    state.fixed = [];
    state.fixedHidden = false;
  }

  function hideFixed() {
    if (state.fixedHidden) return;
    state.fixedHidden = true;
    walkElements(document.body, (el) => {
      if (el === state.host || el === state.target || state.host?.contains(el)) return;
      if (state.mode === "element" && state.target && !state.target.contains(el)) return;
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && position !== "sticky") return;
      state.fixed.push([el, el.style.visibility]);
      el.style.setProperty("visibility", "hidden", "important");
    });
  }

  function retargetFixedBackgrounds() {
    walkElements(document.body, (el) => {
      if (getComputedStyle(el).backgroundAttachment !== "fixed") return;
      state.backgrounds.push([el, el.style.backgroundAttachment]);
      el.style.setProperty("background-attachment", "scroll", "important");
    });
  }

  function walkElements(root, visit) {
    if (!root) return;
    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of nodes) {
      if (!(el instanceof Element) || el.hasAttribute("data-jietu")) continue;
      visit(el);
      if (el.shadowRoot) walkElements(el.shadowRoot, visit);
    }
  }

  function buildOverlay() {
    const host = document.createElement("div");
    host.setAttribute("data-jietu", "");
    for (const [key, value] of Object.entries({
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      overflow: "visible",
      "z-index": "2147483647",
      display: "block",
      "pointer-events": "none",
    })) {
      host.style.setProperty(key, value, "important");
    }
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .dock {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          width: min(360px, calc(100vw - 24px));
          box-sizing: border-box;
          padding: 14px 14px 12px;
          border-radius: 14px;
          background: #fffdf8;
          color: #1c2420;
          font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
          box-shadow: 0 16px 40px rgba(20, 24, 20, 0.22);
          pointer-events: auto;
        }
        strong { display: block; font-size: 15px; font-weight: 650; letter-spacing: 0; }
        p { margin: 4px 0 10px; min-height: 18px; color: #5d675f; font-size: 13px; }
        .track { height: 6px; border-radius: 99px; background: #ece6d8; overflow: hidden; }
        .track i { display: block; height: 100%; width: 0; background: #0e7c66; border-radius: inherit; }
        .row { display: flex; justify-content: flex-end; margin-top: 10px; }
        button {
          border: 0;
          background: transparent;
          color: #0e7c66;
          font: inherit;
          font-size: 13px;
          padding: 4px 2px;
          cursor: pointer;
        }
      </style>
      <div class="dock" role="status" aria-live="polite">
        <strong></strong>
        <p></p>
        <div class="track"><i></i></div>
        <div class="row"><button type="button">取消</button></div>
      </div>
    `;
    state.ui = {
      title: shadow.querySelector("strong"),
      detail: shadow.querySelector("p"),
      bar: shadow.querySelector("i"),
      button: shadow.querySelector("button"),
    };
    state.onAction = () => chrome.runtime.sendMessage({ source: "jietu", type: "cancel" });
    state.ui.button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.onAction();
    });
    state.onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ source: "jietu", type: "cancel" });
    };
    document.addEventListener("keydown", state.onKey, true);
    document.documentElement.append(host);
    state.host = host;
    status({ title: "准备截取", detail: "正在测量页面", progress: 0 });
  }

  function status(message) {
    if (!state.ui) return {};
    showOverlay();
    state.ui.title.textContent = message.title || "";
    state.ui.detail.textContent = message.detail || "";
    state.ui.bar.style.width = `${Math.max(0, Math.min(100, Math.round((message.progress || 0) * 100)))}%`;
    state.ui.button.textContent = "取消";
    state.ui.button.hidden = false;
    state.onAction = () => chrome.runtime.sendMessage({ source: "jietu", type: "cancel" });
    return {};
  }

  function fail(message) {
    if (!state.ui) return {};
    showOverlay();
    state.ui.title.textContent = "没截成";
    state.ui.detail.textContent = message || "请重试";
    state.ui.bar.style.width = "0%";
    state.ui.button.textContent = "关闭";
    state.ui.button.hidden = false;
    state.onAction = () => restore();
    if (state.onKey) {
      document.removeEventListener("keydown", state.onKey, true);
      state.onKey = null;
    }
    return {};
  }

  function showOverlay() {
    if (!state.host) return;
    state.host.style.setProperty("display", "block", "important");
  }

  function hideOverlay() {
    if (!state.host) return;
    state.host.style.setProperty("display", "none", "important");
  }

  function restore() {
    if (state.saved) {
      window.scrollTo(state.saved.x, state.saved.y);
      if (state.target) {
        state.target.scrollTop = state.saved.targetTop || 0;
        state.target.scrollLeft = state.saved.targetLeft || 0;
      }
      document.documentElement.style.pointerEvents = state.saved.pointer || "";
    }
    for (const [el, visibility] of state.fixed) {
      if (visibility) el.style.setProperty("visibility", visibility);
      else el.style.removeProperty("visibility");
    }
    for (const [el, attachment] of state.backgrounds) {
      if (attachment) el.style.setProperty("background-attachment", attachment);
      else el.style.removeProperty("background-attachment");
    }
    state.styleEl?.remove();
    state.host?.remove();
    abortPick();
    if (state.onKey) document.removeEventListener("keydown", state.onKey, true);
    state.mode = "window";
    state.target = null;
    state.fixed = [];
    state.backgrounds = [];
    state.fixedHidden = false;
    state.styleEl = null;
    state.host = null;
    state.ui = null;
    state.onKey = null;
    state.onAction = null;
    state.saved = null;
  }

  function frames(count) {
    return new Promise((resolve) => {
      const step = (left) => {
        if (left <= 0) resolve();
        else requestAnimationFrame(() => step(left - 1));
      };
      step(count);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
