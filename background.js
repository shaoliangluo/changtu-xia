import { MAX_FRAMES, closeGap, intersectBlit, layoutTiles, scrollStops } from "./lib/plan.js";

const RESTRICTED =
  /^(chrome|edge|about|devtools|view-source|chrome-extension|edge-extension|extension|moz-extension):/i;
const STORE =
  /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i;

let job = null;

chrome.action.onClicked.addListener((tab) => {
  if (job) {
    job.cancelled = true;
    chrome.tabs.sendMessage(tab.id, { source: "jietu", type: "abort" }).catch(() => {});
    return;
  }
  const current = { cancelled: false, tabId: tab.id };
  job = current;
  start(tab, current).finally(() => {
    if (job === current) job = null;
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.source !== "jietu" || message.type !== "cancel") return;
  if (job && sender.tab?.id === job.tabId) job.cancelled = true;
});

function isRestricted(url) {
  if (!url) return true;
  return RESTRICTED.test(url) || STORE.test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decodeCapture(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return await createImageBitmap(blob);
  } catch {
    const comma = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, comma);
    const mime = /:(.*?);/.exec(header)?.[1] || "image/png";
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: mime }));
  }
}

async function injectContent(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

/** Talk to the latest injected API. Avoids stale content-script listeners after extension refresh. */
async function callPage(tabId, message) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (attempt > 0) await injectContent(tabId);
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (msg) => {
          const api = globalThis.__JIETU_API__;
          if (!api?.handle) {
            return {
              ok: false,
              error: "页面里还是旧版脚本。请按 F5 刷新这个网页，再点插件图标。",
            };
          }
          try {
            return { ok: true, ...(await api.handle(msg)) };
          } catch (error) {
            return { ok: false, error: error?.message || String(error) };
          }
        },
        args: [{ source: "jietu", ...message }],
      });
      const response = injection?.result;
      if (!response?.ok) throw new Error(response?.error || "页面没有响应");
      return response;
    } catch (error) {
      lastError = error;
      await sleep(80);
    }
  }
  throw lastError;
}

function openEditor(error) {
  const url = new URL(chrome.runtime.getURL("editor.html"));
  if (error) url.searchParams.set("error", error);
  return chrome.tabs.create({ url: url.toString() });
}

function idb() {
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

async function saveShot(record) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("shots", "readwrite");
    tx.objectStore("shots").put(record, "latest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#0e7c66" });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    /* The tab may already be gone. */
  }
}

function drawSprite(bitmap, source, sprite, tiles) {
  const scaleX = sprite.w === 0 ? 1 : source.w / sprite.w;
  const scaleY = sprite.h === 0 ? 1 : source.h / sprite.h;
  for (const tile of tiles) {
    const hit = intersectBlit(sprite, tile);
    if (!hit) continue;
    tile.ctx.drawImage(
      bitmap,
      source.x + hit.sx * scaleX,
      source.y + hit.sy * scaleY,
      hit.sw * scaleX,
      hit.sh * scaleY,
      hit.dx,
      hit.dy,
      hit.sw,
      hit.sh,
    );
  }
}

async function blobsFromTiles(tiles) {
  const parts = [];
  for (const tile of tiles) {
    const blob = await tile.canvas.convertToBlob({ type: "image/png" });
    parts.push(blob);
    tile.canvas.width = 1;
    tile.canvas.height = 1;
  }
  return parts;
}

async function start(tab, current) {
  const url = tab.url || tab.pendingUrl || "";
  if (isRestricted(url)) {
    await openEditor("这个页面不能截。浏览器内置页、扩展商店和新标签页都拦着插件。换一个普通网页再试。");
    return;
  }

  try {
    await injectContent(tab.id);
    const choice = await callPage(tab.id, { type: "pick" });
    if (current.cancelled || choice.captureMode === "cancel") return;
    if (choice.captureMode === "visible" || choice.captureMode === "region") {
      await captureViewport(tab, choice, url);
      return;
    }
    await captureFull(tab, current, url);
  } catch (error) {
    await openEditor(friendly(error?.message || String(error)));
  }
}

async function captureViewport(tab, choice, url) {
  try {
    const active = await chrome.tabs.get(tab.id);
    if (!active.active) throw new Error("页面被切走了，截取已停止。回到原来的标签页后再点一次图标。");
    await sleep(80);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const bitmap = await decodeCapture(dataUrl);
    const scaleX = bitmap.width / choice.windowWidth;
    const scaleY = bitmap.height / choice.windowHeight;
    const rect = choice.captureMode === "region" && choice.rect
      ? choice.rect
      : { x: 0, y: 0, w: choice.windowWidth, h: choice.windowHeight };
    const x = clamp(Math.round(rect.x * scaleX), 0, bitmap.width - 1);
    const y = clamp(Math.round(rect.y * scaleY), 0, bitmap.height - 1);
    const w = clamp(Math.round(rect.w * scaleX), 1, bitmap.width - x);
    const h = clamp(Math.round(rect.h * scaleY), 1, bitmap.height - y);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    canvas.width = 1;
    canvas.height = 1;
    await saveShot({
      parts: [blob],
      meta: {
        title: choice.title || "",
        url: choice.href || url,
        mode: choice.captureMode,
        createdAt: Date.now(),
        warning: "",
        screens: 1,
      },
    });
    await openEditor();
  } catch (error) {
    await openEditor(friendly(error?.message || String(error)));
  }
}

async function captureFull(tab, current, url) {
  let prepared = false;
  let handedToPage = false;

  try {
    const metrics = await callPage(tab.id, { type: "prepare" });
    prepared = true;

    const xs = scrollStops(metrics.pageWidth, metrics.viewportWidth);
    const ys = scrollStops(metrics.pageHeight, metrics.viewportHeight);
    const total = xs.length * ys.length;
    if (total > MAX_FRAMES) {
      throw new Error(`这个页面有 ${total} 屏，一次截完会把浏览器拖死。先把页面缩小，或折起超长内容后再试。`);
    }

    const modeLabel = metrics.mode === "element" ? "主滚动区域" : "整页";
    let tiles = null;
    let scaleX = 1;
    let scaleY = 1;
    let windowWidth = metrics.windowWidth;
    let windowHeight = metrics.windowHeight;
    let coveredBottom = 0;
    let lastActualY = null;
    let lastRequestedY = null;
    let warning = "";
    let index = 0;

    for (const x of xs) {
      coveredBottom = 0;
      lastActualY = null;
      lastRequestedY = null;
      for (const y of ys) {
        if (current.cancelled) {
          await callPage(tab.id, { type: "toast", message: "已取消" }).catch(() => {});
          await sleep(420);
          return;
        }

        index += 1;
        await setBadge(tab.id, String(Math.min(99, Math.round(((index - 1) / total) * 100))));
        await callPage(tab.id, {
          type: "status",
          title: `正在截取${modeLabel}`,
          detail: `第 ${index} / ${total} 屏`,
          progress: (index - 1) / total,
        });

        const active = await chrome.tabs.get(tab.id);
        if (!active.active) {
          throw new Error("页面被切走了，截取已停止。回到原来的标签页后再点一次图标。");
        }

        const frame = await callPage(tab.id, {
          type: "frame",
          x,
          y,
          hideFixed: y > 0,
          first: index === 1,
        });

        if (Math.abs(frame.windowWidth - windowWidth) > 1 || Math.abs(frame.windowHeight - windowHeight) > 1) {
          throw new Error("窗口大小变了，这次截取已停止。");
        }

        if (lastRequestedY !== null && Math.abs(frame.actualY - lastActualY) < 1 && Math.abs(y - lastRequestedY) > 1) {
          warning = "页面滚不到底，长图可能不完整。";
          index -= 1;
          break;
        }
        lastActualY = frame.actualY;
        lastRequestedY = y;

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        const bitmap = await decodeCapture(dataUrl);

        if (!tiles) {
          scaleX = bitmap.width / frame.windowWidth;
          scaleY = bitmap.height / frame.windowHeight;
          const fullW = Math.max(1, Math.round(metrics.pageWidth * scaleX));
          const fullH = Math.max(1, Math.round(metrics.pageHeight * scaleY));
          tiles = layoutTiles(fullW, fullH).map((tile) => {
            const canvas = new OffscreenCanvas(tile.w, tile.h);
            const ctx = canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
            if (!ctx) throw new Error("浏览器不能拼接这张图");
            ctx.imageSmoothingEnabled = false;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, tile.w, tile.h);
            return { ...tile, canvas, ctx };
          });
        }

        await callPage(tab.id, {
          type: "status",
          title: `正在拼接${modeLabel}`,
          detail: `第 ${index} / ${total} 屏`,
          progress: index / total,
        }).catch(() => {});

        const source = sourceRect(bitmap, frame, scaleX, scaleY);
        const drawX = Math.round(frame.actualX * scaleX);
        let drawY = closeGap(Math.round(frame.actualY * scaleY), coveredBottom);
        drawSprite(bitmap, source, { x: drawX, y: drawY, w: source.w, h: source.h }, tiles);
        coveredBottom = Math.max(coveredBottom, drawY + source.h);
        bitmap.close();
      }
    }

    if (!tiles) throw new Error("没有截到画面");

    await setBadge(tab.id, "100");
    const parts = await blobsFromTiles(tiles);
    if (parts.length > 1 && !warning) {
      warning = `页面太长，已分成 ${parts.length} 张，避免图片超出浏览器能保存的尺寸。`;
    }

    await saveShot({
      parts,
      meta: {
        title: metrics.title || "",
        url: metrics.href || url,
        mode: metrics.mode,
        createdAt: Date.now(),
        warning,
        screens: index,
      },
    });

    await callPage(tab.id, { type: "restore" }).catch(() => {});
    prepared = false;
    await openEditor();
  } catch (error) {
    const message = error?.message || String(error);
    if (prepared) {
      try {
        await callPage(tab.id, { type: "fail", message: friendly(message) });
        handedToPage = true;
      } catch {
        handedToPage = false;
      }
    }
    if (!handedToPage) await openEditor(friendly(message));
  } finally {
    if (prepared && !handedToPage) {
      await callPage(tab.id, { type: "restore" }).catch(() => {});
    }
    await setBadge(tab.id, "");
  }
}

function sourceRect(bitmap, frame, scaleX, scaleY) {
  if (frame.mode !== "element" || !frame.rect) {
    return { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  }
  const rect = frame.rect;
  const x = clamp(Math.round(rect.x * scaleX), 0, bitmap.width - 1);
  const y = clamp(Math.round(rect.y * scaleY), 0, bitmap.height - 1);
  const w = clamp(Math.round(rect.w * scaleX), 1, bitmap.width - x);
  const h = clamp(Math.round(rect.h * scaleY), 1, bitmap.height - y);
  return { x, y, w, h };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function friendly(message) {
  const text = String(message || "");
  if (/Cannot access contents|cannot be scripted|extensions gallery|error page/i.test(text)) {
    return "这个页面不让插件动手。本地文件需要在扩展管理页打开「允许访问文件网址」。";
  }
  if (/The extensions gallery cannot be scripted/i.test(text)) {
    return "扩展商店页面不能截。";
  }
  if (/Either the '<all_urls>' or 'activeTab' permission is required/i.test(text)) {
    return "没有拿到当前页面的临时权限。请点工具栏上的长图侠图标再试一次。";
  }
  return text;
}
