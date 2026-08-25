# dsh-git-history

为 DeepSeek Harness Desktop 提供当前工作区及递归 Git 子模块的仓库树和提交历史视图。

## 功能

- 在聊天输入框工具栏新增常驻的 **Git History** 入口，新建空白会话无需先发送消息即可使用。
- 点击入口后通过弹窗显示仓库树和提交历史，不占用 Chat、Trajectory 或工作区侧栏。
- 树状显示当前工作区和所有递归子模块。
- 每个已初始化仓库显示名称、当前分支和 upstream：
  - `数字 ↑` 表示本地领先远程跟踪分支的提交数。
  - `数字 ↓` 表示本地落后远程跟踪分支的提交数。
- 点击根仓库或子模块后，下方切换到对应仓库的 Git History。
- History 显示提交标题、作者、相对时间、短 Hash、分支和标签引用，并支持分页加载。
- 首次打开 Git History 弹窗时先读取本地状态，再自动执行 `git fetch --prune` 更新远程跟踪引用；入口本身不会触发网络请求。
- 手动刷新时重新 fetch 根仓库和所有已初始化子模块；单个仓库 fetch 失败不会清空其本地数据。
- 点击 ahead/behind 数字按钮会按 EnsoAI 的行为同步该仓库：先尝试 fast-forward pull，必要时改用 rebase，再 push。

## 安装

必须安装到 DSH Desktop 使用的 `desktop` Profile：

```bash
dsh plugin add --profile desktop github:lwt-sadais/dsh-git-history
```

也可以安装本地源码目录或打包产物：

```bash
dsh plugin add --profile desktop /绝对路径/dsh-git-history
dsh plugin add --profile desktop /绝对路径/dsh-git-history-0.1.0.tgz
```

安装完成后请完全退出并重新启动 DSH Desktop。运行中的 Host 和 Web 客户端不会自动加载新安装的插件。

卸载：

```bash
dsh plugin remove --profile desktop dsh-git-history
```

卸载后同样需要重启 DSH Desktop。

## 使用

1. 在 DSH Desktop 中打开一个 Git 仓库工作区并进入任意会话（空白新会话也可以）。
2. 点击聊天输入框工具栏中的 **Git History**。
3. 在弹窗仓库树中选择根仓库或任意已初始化子模块。
4. 在右侧查看对应仓库的提交历史；需要更多记录时点击“加载更多”。
5. 点击“刷新并 Fetch”可重新更新远程跟踪引用和 ahead/behind 数值。

没有 upstream 的仓库仍会显示分支和历史，但不会显示 ahead/behind。Detached HEAD 显示为 `detached@<短哈希>`；未初始化子模块只显示名称和“未初始化”状态。

## 安全边界

- 客户端只提交当前会话已有的 Workspace 路径。
- 宿主端会再次使用 DSH Workspace Registry 校验路径，并要求工作区本身就是 Git 根目录。
- 子模块路径只从仓库 `.gitmodules` 读取，并校验解析后的真实路径仍在父仓库内。
- History 只能访问服务端最近一次扫描签发的仓库标识，客户端不能提交任意文件系统路径。
- Git 通过 DSH `subprocess` 参数数组启动，不经 Shell 拼接。
- 设置 `GIT_TERMINAL_PROMPT=0` 且每条 Git 命令最多运行 15 秒，避免认证提示或网络请求无限等待。
- 插件不会执行 checkout 或 reset；仅在用户点击 ahead/behind 数字按钮后执行 pull（必要时 rebase）和 push，自动 fetch 只更新远程跟踪引用。
- 本地 API 仅接受当前 DSH 页面发出的回环地址、同源 JSON POST 请求。

## 本地开发

环境要求：Node.js 22.19+、pnpm。

```bash
pnpm install
pnpm run check
pnpm pack
```

`pnpm run check` 会依次执行 TypeScript 类型检查、Vitest 测试和 Host/Client 构建。客户端包使用 DSH Client Loader 包装，并通过 `conversation.input.left` 插槽注册 `git-history` 工具栏入口。

## 主要结构

```text
src/
├── core/types.ts             # Host 与 Client 共用的数据契约
├── host/git-service.ts       # Git 执行、工作区校验、递归扫描与 History
├── host/routes.ts            # 同源本地 API
├── client/GitHistoryView.tsx # 仓库树和提交历史界面
├── client/api.ts             # Client API
├── client/locales.ts         # 中英文文案
├── client/styles.css         # DSH 主题样式
├── client/index.ts           # conversation.input.left 工具栏注册
└── index.ts                  # Host 插件入口
```

## 致谢与许可

仓库树、子模块状态、ahead/behind 和提交历史交互参考了 [J3n5en/EnsoAI](https://github.com/J3n5en/EnsoAI/tree/test) `test` 分支中的 Source Control 实现，并针对 DSH 的 Cordis 插件架构、Workspace 安全边界和主题系统进行了独立改写。

EnsoAI 与本项目均采用 MIT License。详见 [`LICENSE`](LICENSE)。
