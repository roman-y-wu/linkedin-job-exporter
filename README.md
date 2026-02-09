# LinkedIn Job Pipeline

一个极简 Chrome 扩展：

- 只保留 1 个功能：在 LinkedIn 职位页，点击浏览器工具栏中的扩展图标，立即导出当前 JD 为本地 `TXT`。

## 使用方式

1. 打开 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`，选择当前项目目录
4. 把扩展 `pin` 到工具栏
5. 打开任意 LinkedIn 职位详情页（URL 含 `/jobs/`）
6. 点击一次扩展图标，即可自动导出 JD

导出文件会进入浏览器默认下载目录，命名格式：

- `yyyymmdd_Company_Position_Location.txt`

若重名，浏览器会自动追加编号（`_1`, `_2`...）。

## 功能边界

- 已移除 CSV 追踪、状态面板、OneClick 自动联动等所有非 JD 导出功能。
- 仅支持 Chromium 内核浏览器（Chrome/Edge）。
- 依赖 LinkedIn DOM 结构，页面改版可能影响提取效果。

## 项目结构

```text
linkedin-job-pipeline/
├── manifest.json
├── background.js
├── content.js
├── styles.css
└── icons/
```
