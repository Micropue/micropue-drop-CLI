# DROP CLI 功能与介绍报告

> 适用版本：`@micropue/drop-cli@0.1.1`  
> 文档用途：供 DROP 官方文档维护者或其他 AI 将内容整理到 `drop.micropue.com.cn` 开发者文档。  
> 建议位置：开发者文档 → 工具与集成 → DROP CLI。  
> 实现事实源：本项目仓库中的 CLI、`drop.json` 配置和测试代码。

## 1. 一句话介绍

DROP CLI 是一个面向静态网站的快速部署与持续发布工具。它监听本地目录，在文件发生变化后生成完整站点快照并发布到 DROP，同时在终端显示可访问的公网链接。

它的使用体验接近内网穿透工具，但两者并不相同：DROP CLI 将静态文件真正部署到 DROP；停止监听后网站仍保持在线。

## 2. 产品定位

DROP CLI 面向希望快速上线静态页面的开发者、设计师和内容创作者，减少创建项目、整理文件、调用接口等重复操作。

主要价值：

- 一条命令完成首次部署。
- 修改本地文件后自动更新线上站点。
- 自动保存 slug、项目 ID、公网地址、版本和部署记录。
- 下次进入同一目录时继续使用原有项目，不需要重新创建。
- 可通过 `deploy` 命令在 CI 或脚本中执行单次发布。

CLI 不负责运行构建工具。Vue、React、Astro、Vite 等项目应先将站点构建到静态输出目录，再把该目录交给 DROP CLI 发布。

## 3. 与内网穿透的区别

| 对比项 | DROP CLI | 常见内网穿透 |
| --- | --- | --- |
| 文件位置 | 上传到 DROP 并持久保存 | 文件通常仍位于本地 |
| 本地进程 | 运行时可自动同步 | 通常必须持续运行才能访问 |
| 停止后 | 网站继续在线 | 隧道通常立即失效 |
| 更新方式 | 发布新的完整静态快照 | 实时转发请求 |
| 适用内容 | 静态 HTML、CSS、JavaScript | 任意本地服务 |

## 4. 核心功能

### 4.1 监听并持续发布

运行 `drop` 或 `drop watch` 后，CLI 会：

1. 扫描当前目录中的可发布文件。
2. 首次运行时创建 DROP 项目，后续运行时更新已有项目。
3. 显示线上公网链接。
4. 监听文件内容、文件路径和目录结构变化。
5. 在防抖时间结束后发布一份完整快照。
6. 按 `Ctrl+C` 停止监听，但不会删除线上网站。

### 4.2 完整快照覆盖

每次实际部署都会发送当前项目的完整文件集合，而不是只发送单个改动文件。DROP 以新快照覆盖旧版本，因此删除、重命名和新增文件都会反映到线上。

CLI 默认在内容哈希未变化时跳过部署；使用 `--force` 可强制重新发布。

### 4.3 本地部署记录

CLI 在网站根目录创建 `.drop/`：

- `.drop/drop.json` 保存 slug、项目 ID、可见性、公网地址、远端 revision、CLI 版本号、文件树和哈希等。
- `.drop/` 同时保存本次可部署文件的本地快照。
- 下次启动时直接读取该记录，继续覆盖更新同一项目。
- 如果源码目录暂时没有可扫描的页面，启动阶段可回退到 `.drop` 中的快照。

### 4.4 文件排除

支持 `.drop-ignore`，规则与 `.gitignore` 相同，可排除草稿、私有文件、构建缓存或不需要上线的资源。

### 4.5 公网与密码保护

支持两种可见性：

- `public`：公开访问。
- `password`：密码保护访问，可通过 `--private` 快捷启用。

站点密码不会写入 `drop.json`。

### 4.6 并发与错误恢复

- 写请求携带 `Idempotency-Key`。
- 更新与部署请求携带 `If-Match: "rev-<revision>"`。
- 遇到 `412` revision 冲突时，会读取最新项目 revision 并重试一次。
- 监听期间遇到临时错误会自动重试。
- `429` 和 `503` 支持 `Retry-After`。
- 重复错误会去重显示，避免刷满终端。
- 默认请求超时为 20 秒，可配置。

### 4.7 面向自动化的单次发布

`drop deploy` 只发布一次完整快照后退出，适合 GitHub Actions、GitLab CI、Jenkins 或自定义构建脚本。

## 5. 环境要求

- Node.js `>= 20.12`。
- 一个 DROP Personal API Key。
- API v1 当前只接受 UTF-8 编码的 `.html`、`.css` 和 `.js` 文本文件。

当前不支持图片、字体、JSON、压缩包等二进制或非文本资源。依赖这些资源的页面无法通过现有 API 完整部署。

## 6. 安装

全局安装：

```bash
npm install -g @micropue/drop-cli
```

临时运行：

```bash
npx @micropue/drop-cli --help
```

安装后提供两个等价的命令入口：

```text
drop
drop-cli
```

## 7. 认证

先在 DROP 控制台创建 API Key：

<https://drop.micropue.com.cn/developers/keys>

至少需要以下权限：

```text
projects:read
projects:write
deployments:write
```

保存并验证密钥：

```bash
drop login
```

`drop login` 会在保存前验证密钥。任何其他命令在交互式终端中要求输入 API Key 时，输入后也会自动保存，不需要先单独登录。

检查当前账号：

```bash
drop whoami
```

删除本地保存的密钥：

```bash
drop logout
```

### 7.1 密钥查找顺序

1. 环境变量 `DROP_API_KEY`。
2. 本地认证文件。
3. 交互式终端中隐藏输入；输入后自动保存到本地认证文件。

非交互环境必须提前设置 `DROP_API_KEY`。通过环境变量提供的密钥只对当前进程有效，不会自动写入认证文件。

### 7.2 本地认证文件位置

- macOS / Linux：`${XDG_CONFIG_HOME:-$HOME/.config}/micropue-drop/auth.json`
- Windows：`%APPDATA%\micropue-drop\auth.json`

CLI 会尽量将目录权限设为 `0700`、文件权限设为 `0600`。也可以通过 `DROP_AUTH_FILE` 指定其他路径。

API Key 不会写入 `.drop`。

## 8. 快速开始

### 8.1 公开网站

```bash
cd my-site
drop login
drop
```

首次部署完成后，终端会显示类似以下信息：

```text
✓ Live  https://drop.micropue.com.cn/<account>/<slug>/
│ v1 · revision 1 · 3 files
│ Press Ctrl+C to stop watching. The site stays online.
```

之后修改文件即会自动同步。按 `Ctrl+C` 只停止监听。

### 8.2 指定 slug 和名称

```bash
drop --slug my-site --name "My Site"
```

slug 规则：1–40 位小写字母、数字或连字符，首尾必须为字母或数字。

目录名无法直接生成合法 slug 时，CLI 会自动生成一个可用的 slug。

### 8.3 密码保护

交互式终端：

```bash
drop --private
```

非交互环境：

```bash
DROP_PASSWORD="至少 6 位" drop --private
```

### 8.4 单次发布

```bash
drop deploy .
```

### 8.5 只初始化本地记录

```bash
drop init .
```

`init` 只生成 `.drop/`，不调用 DROP API。之后运行 `drop` 或 `drop watch` 发布。

## 9. 命令参考

| 命令 | 说明 |
| --- | --- |
| `drop [directory]` | 默认命令，等同 `drop watch` |
| `drop watch [directory]` | 监听目录并持续发布 |
| `drop deploy [directory]` | 发布一次完整快照后退出 |
| `drop init [directory]` | 生成 `.drop/`，不发布 |
| `drop status [directory]` | 显示本地部署记录，不请求 API |
| `drop login` | 验证并保存 API Key |
| `drop logout` | 删除本地保存的 API Key |
| `drop whoami` | 显示当前账号、权限和配额 |

查看帮助：

```bash
drop --help
drop watch --help
drop deploy --help
```

### 9.1 `watch` 和 `deploy` 通用选项

| 选项 | 说明 |
| --- | --- |
| `--slug <slug>` | 项目 slug |
| `--name <name>` | 项目显示名称，最多 80 个字符 |
| `--visibility <mode>` | `public` 或 `password` |
| `--private` | 等价于 `--visibility password` |
| `--password <password>` | 站点密码，6–128 个字符 |
| `--api-url <url>` | DROP API 基础地址 |
| `--message <message>` | 部署说明，最多 200 个字符 |
| `--force` | 内容哈希未变化时也重新部署 |

### 9.2 仅 `watch` 或默认命令支持的选项

| 选项 | 说明 |
| --- | --- |
| `--interval <ms>` | 防抖时间，默认 `2000`，最小 `500` |
| `--poll` | 使用轮询监听，适合网络盘或不支持原生文件事件的环境 |

### 9.3 `init` 支持的选项

```text
--slug <slug>
--name <name>
--visibility <mode>
--private
```

## 10. `.drop` 目录

示例：

```text
my-site/
├── index.html
├── assets/
│   └── site.css
├── .drop-ignore
└── .drop/
    ├── drop.json
    ├── index.html
    └── assets/
        └── site.css
```

`.drop/` 的作用：

- 保存项目身份和线上版本信息。
- 保存本次发布文件的可复用快照。
- 支持下一次启动继续更新同一项目。
- 支持在源码扫描不到页面时使用已有快照。

`.drop/` 可能包含网站正文，因此不建议提交到公开仓库。通常应将 `.drop/` 加入 `.gitignore`。

## 11. `drop.json`

### 11.1 完整示例

以下展示首次成功发布后的结构。占位值仅用于说明格式：

```json
{
  "schemaVersion": 1,
  "slug": "my-site",
  "name": "My Site",
  "visibility": "public",
  "projectId": "project_xxxxxxxx",
  "url": "https://drop.micropue.com.cn/<account>/my-site/",
  "revision": 3,
  "version": 2,
  "contentHash": "sha256-hex",
  "files": [
    {
      "path": "index.html",
      "bytes": 1280,
      "sha256": "sha256-hex"
    },
    {
      "path": "assets/site.css",
      "bytes": 640,
      "sha256": "sha256-hex"
    }
  ],
  "folders": [
    "assets"
  ],
  "totalBytes": 1920,
  "hasPassword": false,
  "enabled": true,
  "deploymentId": "deployment_xxxxxxxx",
  "apiBase": "https://drop.micropue.com.cn/v1",
  "createdAt": "2026-11-17T00:00:00.000Z",
  "updatedAt": "2026-11-17T00:00:00.000Z",
  "deployedAt": "2026-11-17T00:00:00.000Z"
}
```

### 11.2 字段说明

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 本地配置格式版本，当前为 `1` |
| `slug` | 项目 slug |
| `name` | 项目显示名称 |
| `visibility` | `public` 或 `password` |
| `projectId` | 线上项目 ID |
| `url` | 公网访问地址 |
| `revision` | 线上项目 revision，用于 `If-Match` |
| `version` | CLI 本地部署版本，不是 API revision |
| `contentHash` | 当前完整快照的哈希 |
| `files` | 文件路径、字节数和 SHA-256 清单 |
| `folders` | 空目录与文件目录组成的目录树 |
| `totalBytes` | 项目总字节数 |
| `hasPassword` | 线上项目是否启用密码保护 |
| `enabled` | 线上项目是否启用 |
| `deploymentId` | 最近一次成功部署 ID |
| `apiBase` | 成功发布时使用的 API 基础地址 |
| `createdAt` | 本地记录首次创建时间 |
| `updatedAt` | 线上项目最近更新时间 |
| `deployedAt` | 最近一次内容部署时间 |

`drop init` 后，`version` 为 `0`，且 `projectId`、`url`、`revision`、`deploymentId` 等远端字段尚不存在。首次成功发布后才会补齐。

不要手工修改 `projectId`、`revision` 或 `contentHash`。删除 `.drop/` 会丢失本地关联记录，但不会删除线上项目。

## 12. 快照哈希和版本规则

`contentHash` 覆盖：

- 每个可发布文件的相对路径。
- 每个文件的 SHA-256。
- 目录列表，包括空目录。

因此以下变化都会触发新快照：

- 修改文件内容。
- 新增、删除或重命名文件。
- 新增、删除或重命名目录。
- 通过 `.drop-ignore` 改变可发布文件集合。

版本规则：

| 场景 | `version` 行为 |
| --- | --- |
| `drop init` | 初始为 `0` |
| 首次成功发布 | 变为 `1` |
| 内容、路径或目录变化 | 每次实际部署递增 |
| 只修改名称、slug 或可见性 | 元数据更新后递增 |
| 修改站点密码 | 元数据更新后递增 |
| `--force` 强制发布 | 递增 |
| 没有变化且未强制 | 不递增 |

`version` 表示 CLI 对项目执行的变更序号；`revision` 表示 DROP 服务端项目修订号。两者含义不同，不应互换。

## 13. `.drop-ignore`

在网站根目录创建 `.drop-ignore`，使用 `.gitignore` 风格：

```gitignore
node_modules/
drafts/
private-*.html
*.min.js
!private-public.html
```

监听期间修改 `.drop-ignore` 会自动触发重新扫描。

以下内容始终不会被发布：

- `.drop/`
- `.git/`
- `node_modules/`
- 隐藏文件和隐藏目录
- 符号链接
- 非 `.html`、`.css`、`.js` 文件
- `.drop-ignore` 文件本身

## 14. 监听机制

默认监听流程：

1. 启动时立即扫描并发布所需变更。
2. 使用 Chokidar 监听文件系统事件。
3. 普通文件写入采用约 200 ms 的稳定性等待。
4. 事件经过防抖后合并为一次完整快照发布。
5. 默认防抖时间为 2 秒，可通过 `--interval` 调整。
6. 额外执行周期性兜底扫描，间隔为 `max(interval × 5, 15 秒)`。
7. 发布失败后使用退避策略重试。

网络盘、虚拟机共享目录或原生监听不可靠时，可使用：

```bash
drop --poll
```

## 15. 发布和并发行为

### 15.1 首次发布

没有有效 `projectId` 时，CLI 调用创建项目接口。项目创建成功后，即使本地终端关闭，网站也会保留在线。

### 15.2 后续发布

已有 `projectId` 时：

- 内容或目录变化：调用部署接口，覆盖完整快照。
- 元数据变化：调用项目更新接口。
- 两者同时变化：先部署内容，再更新元数据。
- 均未变化：跳过网络写入，并显示当前版本和链接。

### 15.3 元数据同步

以下情况会更新线上元数据：

- 修改 `slug`。
- 修改名称。
- 从公开切换为密码保护，或反向切换。
- 显式修改受保护站点的密码。

API v1 不会为旧的 slug 自动创建跳转。修改 slug 后应使用新的公网地址。

### 15.4 密码处理

- 新建密码保护站点时必须提供密码。
- 已有密码保护站点未要求修改密码时，CLI 不会重复发送密码。
- 密码只通过创建或更新项目请求发送。
- 密码不写入 `drop.json`。

## 16. DROP API 对接摘要

默认 API 基础地址：

```text
https://drop.micropue.com.cn/v1
```

CLI 使用以下接口：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /v1/me` | 验证密钥、显示账号、权限与配额 |
| `GET /v1/projects/:projectId` | 获取最新项目 revision |
| `POST /v1/projects` | 创建项目并完成首次部署 |
| `PATCH /v1/projects/:projectId` | 更新名称、slug、可见性或密码 |
| `POST /v1/projects/:projectId/deploy` | 部署新的完整快照 |

请求约定：

- 使用 `Authorization: Bearer <API_KEY>`。
- JSON 请求使用 `Content-Type: application/json`。
- 写请求可携带 `Idempotency-Key`。
- 更新与部署请求携带 `If-Match: "rev-<revision>"`。
- 响应错误会读取 `detail`、`title`、`code`、`requestId` 和 `errors`。
- `Retry-After` 可由秒数或 HTTP 日期表示。

创建项目请求的核心字段：

```json
{
  "name": "My Site",
  "slug": "my-site",
  "visibility": "public",
  "enabled": true,
  "files": [
    {
      "path": "index.html",
      "content": "<h1>Hello</h1>"
    }
  ],
  "folders": [],
  "message": "DROP CLI · v1 · 1 files"
}
```

如果项目使用密码保护，创建请求还会额外包含 `password` 字段；密码不会写入 `drop.json`。

部署请求的核心字段：

```json
{
  "files": [
    {
      "path": "index.html",
      "content": "<h1>Hello, DROP</h1>"
    }
  ],
  "folders": [],
  "message": "DROP CLI · v2 · 1 files"
}
```

## 17. 请求重试与错误处理

- 请求默认超时时间为 20 秒。
- `DROP_REQUEST_TIMEOUT_MS` 可设置 1,000–120,000 毫秒。
- `412 Precondition Failed`：读取最新项目 revision 后重试一次。
- `429` 或 `503` 且带有 `Retry-After`：监听模式等待指定时间后重试。
- 其他监听错误：默认采用至少 5 秒的退避。
- 同一失败快照在退避时间内不会反复请求。
- 连续出现的相同错误只显示一次。
- 初始部署失败会直接退出并返回非零状态码。
- `Ctrl+C` 和 `SIGTERM` 会安全结束监听。

## 18. 安全与路径保护

CLI 在扫描和处理文件时会：

- 拒绝越出网站根目录的路径。
- 拒绝包含 `..`、空路径段或 NUL 字符的路径。
- 跳过符号链接，避免读取目录树外部内容。
- 校验扩展名大小写。
- 以 UTF-8 严格解码文本，非法编码会报错。
- 校验单文件、总大小、文件数、目录数和路径长度限制。
- 使用原子写入方式更新 `.drop/drop.json`。

部署敏感内容前仍需检查：

- `.drop-ignore` 是否覆盖私有文件。
- `.drop/` 是否被加入 Git 忽略。
- 不要把 API Key 写入源码、`.env` 提交文件或公开仓库。
- 优先使用交互输入或 `DROP_PASSWORD`，避免在命令行中直接传密码。

## 19. API v1 限制

| 项目 | 限制 |
| --- | --- |
| 每个项目文件数 | 20 |
| 单文件大小 | 512 KiB |
| 项目总大小 | 1 MiB |
| 每个项目目录数 | 50 |
| 单个文件路径长度 | 120 个字符 |
| 文件类型 | `.html`、`.css`、`.js` |
| 扩展名 | 必须为小写 |
| 文件编码 | UTF-8 |

CLI 会在发送请求前检查上述本地可验证的限制，并给出具体错误。

## 20. 退出与网站生命周期

- `Ctrl+C` 停止监听、关闭文件监听器和当前请求。
- CLI 不发送删除请求。
- 网站继续在线。
- 再次进入同一目录运行 `drop` 会读取 `.drop/drop.json` 并继续更新原项目。
- 当前版本没有 `drop delete` 命令。

## 21. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DROP_API_KEY` | 无 | API Key，优先于本地认证文件且不会自动写入 |
| `DROP_API_BASE` | `https://drop.micropue.com.cn/v1` | API 基础地址 |
| `DROP_PASSWORD` | 无 | 密码保护站点的密码 |
| `DROP_AUTH_FILE` | 系统配置目录 | 自定义认证文件路径 |
| `DROP_REQUEST_TIMEOUT_MS` | `20000` | 请求超时，范围 1,000–120,000 毫秒 |
| `NO_COLOR` | 未设置 | 设置后禁用终端颜色 |

站点命令的 API 地址优先级：

```text
--api-url > DROP_API_BASE > drop.json 中的 apiBase > 默认地址
```

## 22. 常见问题

### 22.1 提示 API Key 无效

```bash
drop logout
drop login
drop whoami
```

并确认密钥具备：

```text
projects:read
projects:write
deployments:write
```

### 22.2 slug 已被占用

使用新的 `--slug`，或恢复该项目原有的 `.drop/drop.json`。DROP 不会自动重定向旧地址。

### 22.3 文件修改后没有上线

检查：

- 扩展名是否为小写 `.html`、`.css` 或 `.js`。
- 文件是否被 `.drop-ignore` 排除。
- 是否为隐藏文件或符号链接。
- 是否超过 API 限制。
- 网络盘环境是否应改用 `--poll`。

单次强制发布：

```bash
drop deploy . --force
```

### 22.4 `Ctrl+C` 后网站为什么仍可访问

因为内容已经部署到 DROP。CLI 进程只负责监听和更新，并不是网站运行所依赖的本地服务。

### 22.5 为什么图片没有上传

当前 API v1 与 CLI 仅支持 `.html`、`.css`、`.js` 文本文件，不接收图片、字体等资源。页面若依赖这些文件，应等待 API 支持或采用其他资源托管方式。

### 22.6 如何重新关联线上项目

保留原 `.drop/drop.json` 和快照；不要删除 `projectId`、`revision`。如果本地记录损坏，可先备份 `.drop/` 再排查。

## 23. 项目与发布信息

| 项目 | 信息 |
| --- | --- |
| npm 包 | `@micropue/drop-cli` |
| 当前版本 | `0.1.1` |
| 命令 | `drop`、`drop-cli` |
| Node.js | `>= 20.12` |
| 开源许可 | MIT |
| GitHub | <https://github.com/Micropue/micropue-drop-CLI> |
| DROP 开发者入口 | <https://drop.micropue.com.cn/developers> |
| DROP API Keys | <https://drop.micropue.com.cn/developers/keys> |

### 23.1 GitHub Actions

仓库包含两套工作流：

- `CI`：在 push 到 `main` 和 Pull Request 时运行，测试 Node.js `20.12` 与 `22`。
- `Release`：在推送 `v*` 标签时运行。

`Release` 工作流会：

1. 安装依赖并运行测试。
2. 校验 Git 标签与 `package.json` 版本一致。
3. 检查该版本是否已经发布到 npm。
4. 如果 npm 上不存在该版本，使用 `NPM_TOKEN` 发布并启用 provenance。
5. 创建 GitHub Release。

维护者发布新版本时，应先更新 `package.json` 版本、提交代码，再创建并推送匹配标签，例如：

```bash
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
```

后续自动发布前，需要在 GitHub 仓库设置 Secret `NPM_TOKEN`。

## 24. 可直接采用的文档简介

> **DROP CLI** 是 DROP 提供的静态网站快速部署工具。它监听本地目录中的 HTML、CSS 和 JavaScript 文件，在内容变化后自动生成完整快照并发布到 DROP。运行一条 `drop` 命令即可创建或更新项目，终端会显示公网链接；按 `Ctrl+C` 停止监听后，网站仍保持在线。CLI 使用 `.drop/drop.json` 保存 slug、项目 ID、公网地址、版本和文件树，使用 `.drop-ignore` 排除文件，并支持公开或密码保护访问、单次部署、版本冲突重试和 CI 自动化调用。

建议文档导航：

```text
DROP 开发者文档
└── 工具与集成
    └── DROP CLI
        ├── 快速开始
        ├── 安装与认证
        ├── 命令参考
        ├── 监听与发布机制
        ├── .drop 与 drop.json
        ├── .drop-ignore
        ├── API 限制
        └── 常见问题
```
