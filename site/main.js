const downloadBtn = document.getElementById("download");
const versionEl = document.getElementById("version");
const pageUrlEl = document.getElementById("page-url");
const qrEl = document.getElementById("qr");

const pageUrl = window.location.href.split("#")[0];
pageUrlEl.textContent = pageUrl;

async function loadMeta() {
  try {
    const res = await fetch("./download-meta.json", { cache: "no-store" });
    if (!res.ok) return;
    const meta = await res.json();
    if (meta.version) versionEl.textContent = meta.version;
    if (meta.path) downloadBtn.href = meta.path;
  } catch {
    // Keep HTML defaults when opened without a packed zip yet.
  }
}

async function renderQr() {
  try {
    const { default: QRCode } = await import(
      "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm"
    );
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, pageUrl, {
      width: 156,
      margin: 1,
      color: {
        dark: "#0a4f41",
        light: "#f7fbf8",
      },
    });
    qrEl.replaceChildren(canvas);
  } catch {
    const img = document.createElement("img");
    img.alt = "下载页二维码";
    img.width = 156;
    img.height = 156;
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=156x156&color=0a4f41&bgcolor=f7fbf8&data=${encodeURIComponent(pageUrl)}`;
    qrEl.replaceChildren(img);
  }
}

await loadMeta();
await renderQr();
