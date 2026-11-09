[English](README.md) · [简体中文](README.zh-CN.md)

# HTML Coursebook

将 Obsidian 仓库里的本地 HTML 课件工程显示为**一份文档**。例如 `atlas/` 中有 `index.html`、`assets/`、`vendor/`，启用后文件树只显示一个带文档图标的 `atlas`；点击直接打开完整交互页面。

桌面端插件；最低支持 Obsidian 1.15.0。已在 macOS 上以 Motion Atlas 课件验证。无需启动 HTTP 服务，不依赖 Obsidian 的 Web Viewer 核心插件。

## 使用

- **点击课件**：打开交互页面。再次点击会切回已经打开的标签。
- **Cmd/Ctrl + 点击或鼠标中键**：另开一个课件标签。
- **正文搜索**：课件页面内按 Cmd/Ctrl + F，或点击右上角搜索按钮；Enter / Shift + Enter 切换结果。
- **查找课件**：左侧书本图标，或命令面板中的 `HTML Coursebook: 打开课件 / 搜索正文`。可按名称、标题或入口页正文检索。
- **右键课件**：复制可粘贴到 Markdown 笔记中的课件链接、在浏览器打开，或临时显示内部文件。
- **刷新**：页面右上角刷新按钮；默认在课件文件变化后自动刷新并尽量保留阅读位置。
- **设置**：可关闭自动刷新，或按仓库相对路径排除目录。排除项每行一个。

插件自动识别含 `index.html` 或 `index.htm` 的目录（也支持大写扩展名）。如果两者同时存在，优先使用 `index.html`。课件内的嵌套入口被视为该课件的一部分；隐藏目录和 `node_modules` 不会成为课件。

## 安装

从 [GitHub Releases](https://github.com/gyula-coder/obsidian-html-coursebook/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放入目标仓库的：

```text
<vault>/.obsidian/plugins/html-coursebook/
  manifest.json
  main.js
  styles.css
```

然后在 Obsidian 的「设置 → 第三方插件」中启用 **HTML Coursebook**。如果刚复制后列表没有更新，可重新打开插件设置或重载 Obsidian。无需开启「显示所有文件类型」。

## 内容与兼容范围

- 目录识别会枚举当前仓库的文件路径；课件搜索读取已识别的入口 HTML。仅在你选择「复制课件链接」时写入剪贴板，不读取剪贴板。

- 原始课件仍是普通文件夹，可由 agent 继续修改。插件不转换或重写课件内容；禁用后文件树恢复普通文件夹显示。
- 课件在独立的 Electron 网页视图中运行，支持本地 CSS、JavaScript、图片、Canvas、Lottie 和 Chromium 支持的媒体格式。网页环境未启用 Node 集成，也没有注入能访问仓库的桥接 API。
- 外部 HTTP、HTTPS 和邮件链接由默认浏览器或应用处理。需要后端服务、npm 开发服务器或远程依赖的工程，仍需各自的运行环境。
- 插件自己的搜索器索引入口 HTML 的静态正文。JavaScript 运行后才生成的内容不进入这个索引；已打开页面可使用页内搜索。Obsidian 原生全局搜索、关系图和反向链接仍采用其原有索引方式。
- HTML 课件属于受信任的本地代码。插件保留浏览器的 Web 安全和沙箱设置，但这不等于对任意第三方 HTML 的安全审计。
- 文件树折叠与标题更新需要少量 Obsidian 内部 DOM / 接口适配。已在上述版本验证；未来 Obsidian 大版本改版可能需要更新插件。
- 本版本仅支持桌面端，不承诺移动端或第三方文件树替代插件的显示兼容性。

## 开发

```sh
npm ci
npm run validate
```

构建后的安装文件是 `main.js`、`manifest.json`、`styles.css`。`src/core.ts` 包含目录识别、路径边界、重命名和搜索逻辑；`src/main.ts` 包含 Obsidian 集成和阅读器。自动化测试覆盖真实的目录边界、入口优先级、忽略项、中文搜索和协议限制。

## 验证流程

除了类型检查和逻辑测试，还通过 Obsidian CLI 在实际仓库中检查：文件树单文档显示、点击打开、真实 Lottie 帧控制、本地图片/视频加载、正文检索、阅读位置恢复、源码模式切换、插件加载生命周期和视觉截图。

## 发布状态与许可

版本 0.1.2；源码已发布到 [GitHub](https://github.com/gyula-coder/obsidian-html-coursebook)。Linux、macOS、Windows 的 CI 构建与测试均已通过；桌面界面仅在 macOS 手动验证。目前尚未进入 Obsidian 社区目录。发布流程见 [PUBLISHING.md](docs/PUBLISHING.md)。

采用 [MIT 许可证](LICENSE)。界面跟随 Obsidian 语言：中文环境显示简体中文，其他环境显示英文。

插件自身不发起网络请求，不含遥测、广告、账号或付费要求；课件自身可能访问远程资源，或通过相对路径引用仓库外的本地文件。本插件不对课件资源建立目录边界。请只打开可信课件。
