# 长图侠

浏览器扩展：整页长图、当前屏幕或框选范围。截图与导出在本地完成，不读取浏览记录，不注入广告。

支持 Chrome / Edge / Firefox。

## 给朋友用（推荐）

### 1. 打包

```bash
npm run pack
```

会生成：

- `dist/changtu-xia-<version>.zip`（可上传到 GitHub Release / 网盘）
- `site/download/changtu-xia-<version>.zip`（落地页下载用）
- `site/download-meta.json`（落地页自动读取版本与下载路径）

### 2. 落地页

打开或托管 `site/` 目录（部署前先跑 `npm run pack`）：

- **本地预览**：`npx --yes serve site`
- **Cloudflare Pages**：Dashboard → Create → Upload `site/` 文件夹（最快）
- **GitHub Pages**：仓库 Settings → Pages → 选 `site/` 目录，或把 `site/` 推到 `gh-pages` 分支

落地页包含：介绍、下载按钮、安装步骤、分享二维码（扫码打开本页）。

### 3. GitHub Release（可选，更正式）

1. 初始化并推送仓库到 GitHub  
2. 创建 Release，上传 `dist/changtu-xia-<version>.zip`  
3. 需要的话，把 `site/download-meta.json` 的 `path` 改成 Release 地址：

```json
{
  "version": "1.2.1",
  "file": "changtu-xia-1.2.1.zip",
  "path": "https://github.com/<user>/<repo>/releases/download/v1.2.1/changtu-xia-1.2.1.zip"
}
```

当前项目还没有 git remote；有 GitHub 账号后可以说一声，我帮你初始化仓库并写好 Release 说明。

## 开发者本地加载

1. Chrome / Edge：打开扩展管理页 → 开发者模式 → 加载已解压的扩展程序 → 选择本仓库根目录
2. Firefox：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → 选择 `manifest.json`

快捷键：`Ctrl+Shift+Y`（Mac：`Command+Shift+Y`）

## 测试

```bash
npm test
```
