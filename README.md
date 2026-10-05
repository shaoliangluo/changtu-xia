# 长图侠

浏览器扩展：整页长图、当前屏幕或框选范围。截图与导出在本地完成，不读取浏览记录，不注入广告。

支持 Chrome / Edge / Firefox。

## 给朋友用

- **落地页**：https://shaoliangluo.github.io/changtu-xia/
- **仓库**：https://github.com/shaoliangluo/changtu-xia
- **Release 下载**：https://github.com/shaoliangluo/changtu-xia/releases/latest

### 打包

```bash
npm run pack
```

会生成：

- `dist/changtu-xia-<version>.zip`（上传到 GitHub Release）
- `docs/download/changtu-xia-<version>.zip`（落地页下载）
- `docs/download-meta.json`（落地页版本信息）

### 本地预览落地页

```bash
npx --yes serve docs
```

## 安装扩展

1. 下载并解压 `changtu-xia-*.zip`
2. Chrome / Edge：打开扩展管理页 → 开发者模式 → 加载已解压的扩展程序
3. Firefox：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → 选择 `manifest.json`

快捷键：`Ctrl+Shift+Y`（Mac：`Command+Shift+Y`）

## 测试

```bash
npm test
```
