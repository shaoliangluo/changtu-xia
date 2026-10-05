import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const zipName = `changtu-xia-${version}.zip`;

const files = [
  "manifest.json",
  "background.js",
  "content.js",
  "editor.html",
  "editor.css",
  "editor.js",
  "lib/plan.js",
  "lib/pdf.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

const distDir = join(root, "dist");
const stagingDir = join(distDir, "staging");
const siteDownloadDir = join(root, "site", "download");
const siteIconsDir = join(root, "site", "icons");
const zipPath = join(distDir, zipName);
const siteZipPath = join(siteDownloadDir, zipName);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
mkdirSync(siteDownloadDir, { recursive: true });
mkdirSync(siteIconsDir, { recursive: true });

for (const rel of files) {
  const from = join(root, rel);
  const to = join(stagingDir, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

for (const icon of ["icon32.png", "icon48.png", "icon128.png"]) {
  copyFileSync(join(root, "icons", icon), join(siteIconsDir, icon));
}

rmSync(zipPath, { force: true });

if (process.platform === "win32") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync("zip", ["-r", zipPath, "."], {
    cwd: stagingDir,
    stdio: "inherit",
  });
}

copyFileSync(zipPath, siteZipPath);

const metaPath = join(root, "site", "download-meta.json");
writeFileSync(
  metaPath,
  `${JSON.stringify(
    {
      version,
      file: zipName,
      path: `./download/${zipName}`,
    },
    null,
    2,
  )}\n`,
);

// PowerShell may briefly lock staging files after Compress-Archive.
for (let i = 0; i < 5; i++) {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
    break;
  } catch {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
}

console.log(`Packed ${zipName}`);
console.log(`→ ${zipPath}`);
console.log(`→ ${siteZipPath}`);
