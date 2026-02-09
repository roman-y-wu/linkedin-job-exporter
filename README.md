# LinkedIn Job Pipeline

Chrome Extension (Manifest V3)，用于在 LinkedIn Jobs 页面完成两件事：

1. 将职位描述导出为本地 `TXT` 文件。
2. 将申请追踪信息同步到本地 `CSV`（状态、轮次、备注、时间戳）。

## 功能概览

- `CSV` 绑定与校验
  - 支持绑定已有 CSV。
  - 支持一键创建标准模板 CSV。
  - 自动校验表头（兼容旧版含 `job_key` 表头）。
- `TXT` 输出目录绑定
  - 绑定一个本地目录作为 JD 导出目标目录。
  - 自动处理重名文件（追加 `_1`, `_2`...）。
- 一键导出并追踪
  - 从当前 LinkedIn 职位页提取标题、公司、地点、JD 内容。
  - 导出 `TXT` 同时执行 CSV upsert（按 `job_id/job_url` 作为主键逻辑）。
- Popup 追踪面板
  - 维护 `status / round1-3 / notes`。
  - 支持对当前职位记录做保存。
- 可靠性处理
  - 消息超时保护与无响应保护。
  - 句柄可用性校验（避免无效 handle 导致运行时异常）。
  - 错误码映射与重绑提示。

## 运行要求

- Chrome/Edge（Chromium 内核，支持 Manifest V3）
- 需要本地文件系统访问能力（File System Access API）
- 可访问 `https://www.linkedin.com/jobs/*`

## 安装方式（开发者模式）

1. 打开 `chrome://extensions`
2. 开启右上角 `Developer mode`
3. 点击 `Load unpacked`
4. 选择项目目录：`/Users/roman/Projects/linkedin-job-downloader`
5. 在扩展列表确认名称为 `LinkedIn Job Pipeline`

## 快速开始

1. 打开任意 LinkedIn 职位详情页（URL 包含 `/jobs/`）。
2. 点击扩展图标打开 Popup。
3. 在 `CSV Binding` 区域：
   - 选择 `绑定现有 CSV`，或
   - 选择 `创建标准模板 CSV`。
4. 在 `TXT Output Folder` 区域点击 `设置 TXT 保存文件夹`。
5. 在 `Track Record` 里可先调整状态、轮次、备注。
6. 点击 `导出 TXT（并追踪）`。
7. 成功后状态栏会显示：
   - `导出完成：{文件名}；CSV 已同步。`

## 文件命名与落盘规则

- TXT 文件名格式：
  - `yyyymmdd_Company_Position_Location.txt`
- 若同名已存在：
  - 自动写为 `..._1.txt`, `..._2.txt`...
- CSV 写入规则：
  - 追加模式保存历史记录。
  - 同一职位主键匹配优先级：`job_id` > `job_url` > `job_key(legacy)`。

## CSV 表头规范

标准表头（当前版本）：

```csv
job_id,company,position,location,job_url,status,saved_at,applied_at,interview_at,rejected_at,round1_pass,round2_pass,round3_pass,notes,created_at,updated_at
```

兼容旧表头（legacy）：

```csv
job_key,job_id,company,position,location,job_url,status,saved_at,applied_at,interview_at,rejected_at,round1_pass,round2_pass,round3_pass,notes,created_at,updated_at
```

## 项目结构

```text
linkedin-job-downloader/
├── manifest.json          # 扩展配置
├── popup.html             # Popup UI
├── popup.js               # Popup 逻辑：绑定、导出触发、状态展示
├── popup.css              # Popup 样式
├── content.js             # 页面注入脚本：抓取、导出、消息处理
├── background.js          # Service Worker：文件句柄、CSV/TXT IO、状态管理
├── styles.css             # 页面内 UI 样式（追踪面板/Toast）
├── lib/
│   ├── tracker_csv.js     # CSV 解析/序列化/表头匹配
│   └── html2pdf.bundle.min.js
└── icons/
```

## 权限说明

`manifest.json` 当前权限：

- `activeTab`: 访问当前激活标签页
- `scripting`: 注入 content script / CSS
- `tabs`: 读取当前标签信息
- `storage`: 保存绑定状态与元数据

## 故障排查

### 1) “CSV 未绑定”或“需要重新绑定”

- 先在 Popup 重新执行一次 `绑定现有 CSV` 或 `创建标准模板 CSV`。
- 再次导出前确认 `CSV Binding` 显示为已绑定。

### 2) “TXT 保存文件夹权限不足 / 不可用”

- 重新点击 `设置 TXT 保存文件夹`，选择可写目录。
- 避免把目录移动/删除后继续使用旧绑定。

### 3) “handle.getFile is not a function”

- 这是无效句柄导致的典型报错（通常出现在历史绑定状态损坏时）。
- 重新绑定 CSV 与 TXT 输出目录可恢复。

### 4) 点击后无响应 / 超时

- 刷新 LinkedIn 页面后重试。
- 在 `chrome://extensions` 中 `Reload` 扩展。
- 检查是否在职位详情页（必须是 `/jobs/`）。

### 5) CSV 不更新但 TXT 已写入

- 检查 Popup 顶部状态消息是否提示 `CSV 同步失败`。
- 确认 CSV 表头未被手工改动。

## 调试建议

1. 打开 `chrome://extensions`
2. 在扩展卡片中：
   - 进入 popup 调试控制台（Inspect views）
   - 打开 service worker 日志（background）
3. 关注消息链路：
   - `TRACKER_*`
   - `TXT_*`

## 隐私与数据

- 本扩展不上传数据到远程服务。
- 职位数据仅写入你本地选择的 CSV 与目录。
- 绑定句柄与状态元数据保存在浏览器本地存储。

## 已知限制

- 依赖 LinkedIn 页面 DOM 结构，LinkedIn 改版可能导致抓取失败。
- 仅支持 Chromium 内核浏览器。
- 文件系统权限由浏览器策略控制，可能受系统/策略限制。

