# DROP CLI

把本地静态网站持续发布到 [DROP](https://drop.micropue.com.cn/developers)。`drop` 会监听当前目录，在文件变化后发布一份完整快照，并显示可直接访问的公网链接。

它适合本地预览、快速分享和轻量静态站点部署，使用体验接近内网穿透工具，但部署内容会持久保存在 DROP：

```text
本地目录 ──监听/防抖──> 完整快照 ──DROP REST API──> 公网链接
    │                         │
    └── .drop-ignore          └── .drop/drop.json
```

按 `Ctrl+C` 只会停止本地监听，不会删除已经上线的网站。

## 环境要求

- Node.js `>= 20.12`
- 一个 DROP Personal API Key

API v1 目前只接受 UTF-8 编码的 `.html`、`.css` 和 `.js` 文件，不能上传图片、字体等二进制资源。

## 安装与登录

全局安装：

```bash
npm install -g @micropue/drop-cli
```

也可以直接运行：

```bash
npx @micropue/drop-cli --help
```

在 [DROP API Keys](https://drop.micropue.com.cn/developers/keys) 创建密钥。至少需要以下权限：

```text
projects:read
projects:write
deployments:write
```

然后保存并验证密钥：

```bash
drop login
```

`drop login` 会在保存前验证密钥。任何命令在交互式终端中要求输入 API Key 时，输入后也会自动保存，不需要先单独执行 `drop login`。

密钥保存在当前用户配置目录下的 `micropue-drop/auth.json`，文件权限为 `0600`。也可以用环境变量临时覆盖：

```bash
export DROP_API_KEY="你的 API Key"
drop whoami
```

不要把 API Key 写入 `.drop`、网站源码或 Git 仓库。

## 快速开始

进入网站根目录后直接运行：

```bash
cd my-site
drop
```

也可以显式使用 `watch`：

```bash
drop watch .
```

首次发布时，如果目录名不能直接作为 slug，CLI 会生成一个安全 slug。也可以在命令行指定：

```bash
drop watch . --slug my-site --name "My Site"
```

发布成功后，终端会显示公网地址；后续改动会在防抖窗口结束后自动覆盖线上旧文件。按 `Ctrl+C` 结束监听。

### 私有站点

`--private` 等价于 `--visibility password`：

```bash
drop watch . --private
```

交互式终端会隐藏输入站点密码。CI 或非交互环境应使用环境变量：

```bash
DROP_PASSWORD="至少 6 位" drop watch . --private
```

也可以使用 `--password <password>`，但不建议这样操作，因为参数可能留在 shell 历史或进程列表中。站点密码不会写入 `drop.json`。

## 命令

```text
drop [directory]          监听并发布，默认命令
drop watch [directory]    监听并持续发布
drop deploy [directory]   发布一次完整快照后退出
drop init [directory]     只生成 .drop，不调用 DROP API
drop status [directory]   显示本地部署记录
drop login                验证并保存 API Key
drop logout               删除本地保存的 API Key
drop whoami               显示当前账号、权限和配额
```

查看完整帮助：

```bash
drop --help
drop watch --help
```

### 发布选项

| 选项 | 说明 |
| --- | --- |
| `--slug <slug>` | DROP 项目 slug，1–40 位小写字母、数字或连字符 |
| `--name <name>` | 项目显示名称，1–80 个字符 |
| `--visibility <mode>` | `public` 或 `password` |
| `--private` | `--visibility password` 的快捷方式 |
| `--password <password>` | 受保护站点的密码，6–128 个字符 |
| `--api-url <url>` | DROP API 地址 |
| `--message <message>` | 部署说明，最多 200 个字符 |
| `--interval <ms>` | 文件变化后的防抖时间，默认 `2000`，最小 `500` |
| `--poll` | 使用轮询监听，适合网络盘或原生监听不可用的环境 |
| `--force` | 即使内容哈希未变化也重新部署 |

`--slug`、`--name` 和可见性发生变化时，CLI 会更新线上项目元数据，并递增本地部署版本。

## `.drop` 目录

每次发布都会把本次可部署的文件完整同步到 `<site>/.drop/`。下次启动时，如果源码目录暂时没有可扫描的页面，CLI 会回退读取这份快照。

```text
my-site/
├── index.html
├── assets/site.css
├── .drop-ignore
└── .drop/
    ├── drop.json
    ├── index.html
    └── assets/site.css
```

`.drop` 中不保存 API Key。若站点本身包含私有内容，不要把它提交到公开仓库。

### `drop.json`

`drop.json` 是本地部署记录，主要字段如下：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 配置格式版本 |
| `slug` / `name` | 项目标识与名称 |
| `visibility` | `public` 或 `password` |
| `projectId` | 线上 DROP 项目 ID |
| `url` | 公网访问地址 |
| `revision` | 线上项目修订号，用于 `If-Match` 并发保护 |
| `version` | CLI 部署版本；内容或元数据变化时递增 |
| `contentHash` | 本次快照哈希，用于跳过无变化部署 |
| `files` | 文件树，以及每个文件的字节数和 SHA-256 |
| `folders` | 空目录和文件目录组成的目录树 |
| `totalBytes` | 项目总字节数 |
| `hasPassword` / `enabled` | 线上访问保护与启用状态 |
| `deploymentId` | 最近一次部署 ID |
| `createdAt` / `updatedAt` / `deployedAt` | 本地记录和部署时间 |

不要手工修改 `projectId`、`revision` 或 `contentHash`。需要重新开始时，可删除 `.drop` 后重新运行；这不会删除线上项目，但会丢失本地部署记录。

## 排除文件

在网站根目录创建 `.drop-ignore`，使用与 `.gitignore` 相同的规则：

```gitignore
node_modules/
draft-*.html
private/
*.min.js
!private/public.html
```

以下内容始终不会被发布：

- `.drop/`
- `.git/`
- `node_modules/`
- 隐藏文件和隐藏目录
- 符号链接
- 非 `.html`、`.css`、`.js` 文件

监听 `.drop-ignore` 后，规则变化会自动触发一次重新扫描。

## 发布机制

- 每次部署发送完整文件集合，线上旧文件会被原子替换；失败时旧快照保持不变。
- 文件内容、文件路径或目录结构变化都会更新快照哈希。
- 每次实际变更都会递增 `drop.json` 中的 `version`。
- 写请求携带 `Idempotency-Key`；更新和部署携带 `If-Match` revision。
- 遇到 `412` 修订冲突时，CLI 会读取最新 revision 并重试一次。
- `429` / `503` 的 `Retry-After` 会在后续监听重试中生效。
- 监听过程中重复错误会去重显示，随后自动重试；按 `Ctrl+C` 可随时退出。

## 限制

DROP API v1 当前限制：

| 项目 | 限制 |
| --- | --- |
| 每个项目文件数 | 20 |
| 单文件大小 | 512 KiB |
| 项目总大小 | 1 MiB |
| 每个项目目录数 | 50 |
| 单个文件路径 | 120 个字符 |
| 文件类型 | `.html`、`.css`、`.js`，扩展名必须小写 |

CLI 会在发送请求前检查这些限制并给出具体错误。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DROP_API_KEY` | 无 | API Key；优先于本地保存的密钥，不会自动写入认证文件 |
| `DROP_API_BASE` | `https://drop.micropue.com.cn/v1` | API 基础地址 |
| `DROP_PASSWORD` | 无 | 私有站点密码，适合非交互环境 |
| `DROP_AUTH_FILE` | 系统配置目录 | 自定义认证文件路径 |
| `DROP_REQUEST_TIMEOUT_MS` | `20000` | 请求超时，范围 1,000–120,000 毫秒 |
| `NO_COLOR` | 未设置 | 设置后禁用终端颜色 |

## 常见问题

**提示 API Key 无效**

```bash
drop logout
drop login
drop whoami
```

同时确认密钥拥有 `projects:read`、`projects:write` 和 `deployments:write`。

**slug 已被占用**

换一个 slug，或在 `drop.json` 中恢复该站点原有的 slug。API v1 不会自动重定向旧地址。

**文件已修改但没有上线**

确认文件扩展名为小写 `.html`、`.css` 或 `.js`，且没有被 `.drop-ignore` 排除。网络盘可尝试 `--poll`。需要强制发布时运行：

```bash
drop deploy . --force
```

**`Ctrl+C` 后网站还在吗**

在。退出只停止监听和本次 CLI 进程，不会发送删除请求。

## 开发

```bash
npm ci
npm test
npm pack --dry-run
```

主要代码：

```text
src/cli.js             命令定义
src/commands/          CLI 命令
src/lib/api.js         DROP REST 客户端
src/lib/deployer.js    项目创建、元数据更新与快照部署
src/lib/discovery.js   文件扫描和限制校验
src/lib/config.js      .drop 同步与 drop.json 原子写入
src/lib/snapshot.js    源码快照与 .drop 回退
```

## GitHub Actions 发布

仓库使用两个工作流：

- `.github/workflows/ci.yml`：在 push 到 `main` 和 Pull Request 时测试 Node.js 20.12 / 22。
- `.github/workflows/release.yml`：推送 `v*` tag 时测试、发布 npm 并创建 GitHub Release。

首次发布需要手动执行：

```bash
npm login
npm publish --access public
```

之后在 GitHub 仓库设置 Secrets 中添加 `NPM_TOKEN`，或配置 npm Trusted Publisher，然后发布新版本：

```bash
npm version patch
git push
git push --follow-tags
```

tag 必须与 `package.json` 版本一致，例如 `v0.1.1`。如果该版本已经存在于 npm，工作流会跳过 npm 发布，但仍会创建 GitHub Release。

## License

[MIT](./LICENSE)
