import { encodePdf } from "./lib/pdf.js";

const params = new URLSearchParams(location.search);
const metaEl = document.querySelector("#meta");
const tools = document.querySelector("#tools");
const notice = document.querySelector("#notice");
const statusEl = document.querySelector("#status");
const stage = document.querySelector("#stage");
const empty = document.querySelector("#empty");
const quality = document.querySelector("#quality");
const qualityValue = document.querySelector("#quality-value");

const pngButton = document.querySelector("#png");
const jpgButton = document.querySelector("#jpg");
const copyButton = document.querySelector("#copy");
const pdfButton = document.querySelector("#pdf");
const zoomButton = document.querySelector("#zoom");
const cropResetButton = document.querySelector("#crop-reset");

let parts = [];
let meta = {};
let index = 0;
let fit = true;
let objectUrl = "";
let nativeSize = { w: 0, h: 0 };
let crop = { x: 0, y: 0, w: 0, h: 0 };

init().catch((error) => showError(error?.message || String(error)));

async function init() {
  if (params.get("error")) {
    showError(params.get("error"));
    return;
  }

  if (params.get("demo") === "1") {
    parts = [await demoBlob()];
    meta = {
      title: "示例长图",
      url: "https://example.com/docs/guide",
      mode: "window",
      createdAt: Date.now(),
      warning: "",
      screens: 4,
    };
  } else {
    const record = await loadShot();
    if (!record?.parts?.length) {
      metaEl.textContent = "还没有截图";
      return;
    }
    parts = record.parts;
    meta = record.meta || {};
  }

  empty.hidden = true;
  tools.hidden = false;
  if (meta.warning) {
    notice.hidden = false;
    notice.textContent = meta.warning;
  }
  bind();
  if (meta.mode === "region") {
    notice.hidden = false;
    notice.textContent = [meta.warning, "可拖动图上的绿框再裁一刀。没截进来的部分补不回来，要补全请回原网页重新框选。"]
      .filter(Boolean)
      .join(" ");
  }
  await render();
}

function bind() {
  pngButton.addEventListener("click", () => run("正在导出 PNG", exportPng));
  jpgButton.addEventListener("click", () => run("正在导出 JPG", exportJpg));
  copyButton.addEventListener("click", () => run("正在复制", copyImage));
  pdfButton.addEventListener("click", () => run("正在生成 PDF", exportPdf));
  zoomButton.addEventListener("click", () => {
    fit = !fit;
    zoomButton.textContent = fit ? "实际大小" : "适应宽度";
    stage.classList.toggle("actual", !fit);
    requestAnimationFrame(() => {
      layoutCrop();
      refreshMeta();
    });
  });
  cropResetButton.addEventListener("click", () => {
    crop = { x: 0, y: 0, w: nativeSize.w, h: nativeSize.h };
    layoutCrop();
    refreshMeta();
    setStatus("已还原为整张图");
  });
  quality.addEventListener("input", () => {
    qualityValue.textContent = `${quality.value}%`;
  });
  window.addEventListener("resize", () => {
    layoutCrop();
    if (fit) refreshMeta();
  });
  window.addEventListener("pagehide", revoke);
}

async function render() {
  revoke();
  const blob = parts[index];
  const bitmap = await createImageBitmap(blob);
  nativeSize = { w: bitmap.width, h: bitmap.height };
  crop = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  bitmap.close();
  objectUrl = URL.createObjectURL(blob);

  stage.replaceChildren();
  if (parts.length > 1) {
    const pager = document.createElement("div");
    pager.className = "pager";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "上一张";
    prev.disabled = index === 0;
    prev.addEventListener("click", () => switchPart(index - 1));
    const label = document.createElement("span");
    label.textContent = `${index + 1} / ${parts.length}`;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "下一张";
    next.disabled = index === parts.length - 1;
    next.addEventListener("click", () => switchPart(index + 1));
    pager.append(prev, label, next);
    stage.append(pager);
  }

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const image = document.createElement("img");
  image.src = objectUrl;
  image.alt = meta.title || "网页长图";
  const cropEl = document.createElement("div");
  cropEl.className = "crop";
  cropEl.innerHTML = `
    <span class="label"></span>
    <i class="handle n" data-handle="n"></i>
    <i class="handle s" data-handle="s"></i>
    <i class="handle e" data-handle="e"></i>
    <i class="handle w" data-handle="w"></i>
    <i class="handle ne" data-handle="ne"></i>
    <i class="handle nw" data-handle="nw"></i>
    <i class="handle se" data-handle="se"></i>
    <i class="handle sw" data-handle="sw"></i>
  `;
  sheet.append(image, cropEl);
  stage.append(sheet);
  stage.classList.toggle("actual", !fit);
  bindCrop(cropEl, image);
  image.addEventListener("load", () => {
    layoutCrop();
    refreshMeta();
  }, { once: true });
  layoutCrop();
  refreshMeta();
}

function displayScale() {
  const img = document.querySelector(".sheet img");
  const w = img?.clientWidth || nativeSize.w;
  const h = img?.clientHeight || nativeSize.h;
  return {
    x: nativeSize.w / Math.max(1, w),
    y: nativeSize.h / Math.max(1, h),
  };
}

function layoutCrop() {
  const cropEl = document.querySelector(".crop");
  if (!cropEl || !nativeSize.w) return;
  const scale = displayScale();
  cropEl.style.left = `${crop.x / scale.x}px`;
  cropEl.style.top = `${crop.y / scale.y}px`;
  cropEl.style.width = `${crop.w / scale.x}px`;
  cropEl.style.height = `${crop.h / scale.y}px`;
  cropEl.style.right = "auto";
  cropEl.style.bottom = "auto";
  const label = cropEl.querySelector(".label");
  if (label) label.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
}

function clampCrop(next) {
  const min = 16;
  let x = next.x;
  let y = next.y;
  let w = next.w;
  let h = next.h;
  if (w < min) w = min;
  if (h < min) h = min;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > nativeSize.w) {
    if (next.lockRight) x = nativeSize.w - w;
    else w = nativeSize.w - x;
  }
  if (y + h > nativeSize.h) {
    if (next.lockBottom) y = nativeSize.h - h;
    else h = nativeSize.h - y;
  }
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  crop = {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(min, Math.round(w)),
    h: Math.max(min, Math.round(h)),
  };
}

function bindCrop(cropEl, image) {
  let drag = null;

  cropEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    cropEl.setPointerCapture(event.pointerId);
    const handle = event.target.getAttribute("data-handle") || "move";
    drag = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      crop: { ...crop },
    };
  });

  cropEl.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const scale = displayScale();
    const dx = (event.clientX - drag.startX) * scale.x;
    const dy = (event.clientY - drag.startY) * scale.y;
    const next = { ...drag.crop, lockRight: false, lockBottom: false };
    const handle = drag.handle;
    if (handle === "move") {
      next.x = drag.crop.x + dx;
      next.y = drag.crop.y + dy;
      next.lockRight = true;
      next.lockBottom = true;
    }
    if (handle.includes("w")) {
      next.x = drag.crop.x + dx;
      next.w = drag.crop.w - dx;
    }
    if (handle.includes("e")) next.w = drag.crop.w + dx;
    if (handle.includes("n")) {
      next.y = drag.crop.y + dy;
      next.h = drag.crop.h - dy;
    }
    if (handle.includes("s")) next.h = drag.crop.h + dy;
    clampCrop(next);
    layoutCrop();
    refreshMeta();
  });

  const stop = () => {
    drag = null;
  };
  cropEl.addEventListener("pointerup", stop);
  cropEl.addEventListener("pointercancel", stop);
  image.addEventListener("load", layoutCrop);
}

function switchPart(nextIndex) {
  index = nextIndex;
  render().catch((error) => setStatus(error.message));
}

async function exportPng() {
  const blob = await exportBlob("image/png");
  const size = currentExportSize();
  downloadBlob(blob, `${fileBase(size)}.png`);
  setStatus(`PNG 已开始下载 · ${size.w} × ${size.h}${fit ? "（适应宽度）" : "（实际像素）"}`);
}

async function exportJpg() {
  const q = Number(quality.value);
  const blob = await exportBlob("image/jpeg", q / 100);
  const size = currentExportSize();
  downloadBlob(blob, `${fileBase(size)}-q${q}.jpg`);
  setStatus(`JPG 已开始下载 · ${size.w} × ${size.h} · 质量 ${q}% · ${formatBytes(blob.size)}`);
}

function sourceSize() {
  return {
    w: Math.max(1, Math.round(crop.w || nativeSize.w)),
    h: Math.max(1, Math.round(crop.h || nativeSize.h)),
  };
}

function currentExportSize() {
  const source = sourceSize();
  if (!fit || !nativeSize.w) return source;
  const img = document.querySelector(".sheet img");
  const displayW = img?.clientWidth || Math.min(960, window.innerWidth - 40);
  const scale = displayW / nativeSize.w;
  return {
    w: Math.max(1, Math.round(crop.w * scale)),
    h: Math.max(1, Math.round(crop.h * scale)),
  };
}

function refreshMeta() {
  const modeNames = { element: "主滚动区域", visible: "当前屏幕", region: "框选范围" };
  const modeLabel = modeNames[meta.mode] || "整页";
  const zoomLabel = fit ? "适应宽度" : "实际大小";
  let host = "";
  try {
    host = new URL(meta.url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const size = currentExportSize();
  const cropped = crop.w !== nativeSize.w || crop.h !== nativeSize.h || crop.x !== 0 || crop.y !== 0;
  const dim = `${size.w} × ${size.h}${cropped ? "（已裁剪）" : ""}`;
  const origin = cropped ? `原图 ${nativeSize.w} × ${nativeSize.h}` : "";
  metaEl.textContent = [modeLabel, zoomLabel, dim, origin, host].filter(Boolean).join(" · ");
}

async function exportBlob(type, qualityLevel) {
  const source = parts[index];
  const size = currentExportSize();
  const cropped = crop.x !== 0 || crop.y !== 0 || crop.w !== nativeSize.w || crop.h !== nativeSize.h;
  const unchanged =
    type === "image/png" &&
    !cropped &&
    size.w === nativeSize.w &&
    size.h === nativeSize.h &&
    source.type === "image/png";
  if (unchanged) return source;
  return rasterize(source, size.w, size.h, type, qualityLevel);
}

async function rasterize(blob, width, height, type, qualityLevel) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: type !== "image/jpeg" }) || canvas.getContext("2d");
    if (type === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = width !== crop.w || height !== crop.h;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
    const out = await new Promise((resolve) => {
      if (type === "image/jpeg") canvas.toBlob(resolve, type, qualityLevel);
      else canvas.toBlob(resolve, type);
    });
    canvas.width = 1;
    canvas.height = 1;
    if (!out) throw new Error("这张图太大，浏览器导不出。可以改成适应宽度后再试。");
    return out;
  } finally {
    bitmap.close();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function copyImage() {
  const blob = await exportBlob("image/png");
  window.focus();
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (error) {
    const text = error?.message || String(error);
    if (/not focused|NotAllowed|denied|gesture/i.test(text)) {
      throw new Error("浏览器没让写入剪贴板。点一下这个预览页，再按一次复制。");
    }
    throw error;
  }
  setStatus(`已复制到剪贴板 · ${currentExportSize().w} × ${currentExportSize().h}`);
}

async function exportPdf() {
  const cropped = await exportBlob("image/png");
  const pdf = await imageBlobToPdf(cropped);
  downloadBlob(pdf, `${fileBase(currentExportSize())}.pdf`);
  setStatus("PDF 已开始下载");
}

async function run(label, task) {
  setBusy(true);
  setStatus(label);
  try {
    await task();
  } catch (error) {
    setStatus(error?.message || String(error));
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  for (const button of [pngButton, jpgButton, copyButton, pdfButton, zoomButton, cropResetButton]) {
    button.disabled = busy;
  }
}

function setStatus(message) {
  statusEl.hidden = !message;
  statusEl.textContent = message || "";
}

function showError(message) {
  tools.hidden = true;
  empty.hidden = false;
  empty.textContent = message;
  metaEl.textContent = "无法预览";
}

async function imageBlobToPdf(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const pageWidth = 595.28;
    const pageLimit = 841.89;
    const margin = 28;
    const drawWidth = pageWidth - margin * 2;
    const scale = drawWidth / bitmap.width;
    const sliceHeight = Math.max(1, Math.floor((pageLimit - margin * 2) / scale));
    const pages = [];

    for (let y = 0; y < bitmap.height; y += sliceHeight) {
      const height = Math.min(sliceHeight, bitmap.height - y);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, y, bitmap.width, height, 0, 0, bitmap.width, height);
      const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      canvas.width = 1;
      canvas.height = 1;
      if (!jpegBlob) throw new Error("这张图太大，浏览器拼不出 PDF。可以先下载 PNG。");
      const drawHeight = height * scale;
      pages.push({
        jpeg: new Uint8Array(await jpegBlob.arrayBuffer()),
        imgWidth: bitmap.width,
        imgHeight: height,
        pageWidth,
        pageHeight: margin * 2 + drawHeight,
        drawWidth,
        drawHeight,
        offsetX: margin,
        offsetY: margin,
      });
    }

    return new Blob([encodePdf(pages)], { type: "application/pdf" });
  } finally {
    bitmap.close();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

function fileBase(size) {
  let host = "page";
  try {
    host = new URL(meta.url).hostname.replace(/^www\./, "");
  } catch {
    host = "page";
  }
  const day = new Date(meta.createdAt || Date.now()).toISOString().slice(0, 10);
  const part = parts.length > 1 ? `-${index + 1}` : "";
  const dim = size?.w ? `-${size.w}x${size.h}` : "";
  return `长图侠-${host}-${day}${part}${dim}`;
}

function revoke() {
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  objectUrl = "";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("jietu-changtu", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("shots")) db.createObjectStore("shots");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadShot() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("shots", "readonly");
      const request = tx.objectStore("shots").get("latest");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function demoBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = 880;
  canvas.height = 2200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0e7c66";
  ctx.fillRect(0, 0, canvas.width, 72);
  ctx.fillStyle = "#fffdf8";
  ctx.font = "600 28px Segoe UI, Microsoft YaHei, sans-serif";
  ctx.fillText("长图侠示例", 28, 46);
  for (let band = 0; band < 10; band += 1) {
    const y = 100 + band * 200;
    ctx.fillStyle = band % 2 ? "#f4f0e6" : "#e7f3ef";
    ctx.fillRect(28, y, canvas.width - 56, 180);
    ctx.fillStyle = "#1c2420";
    ctx.font = "600 42px Segoe UI, Microsoft YaHei, sans-serif";
    ctx.fillText(String(band + 1).padStart(2, "0"), 48, y + 78);
    ctx.font = "16px Segoe UI, Microsoft YaHei, sans-serif";
    ctx.fillStyle = "#5e675f";
    ctx.fillText("用来确认预览、下载和 PDF 导出。", 48, y + 116);
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  canvas.width = 1;
  canvas.height = 1;
  return blob;
}
