# StoryMaker

给游戏策划用的**剧情对话编辑器**，用来替代原来的「Excel 填表 + 表格公式规整」流程。
编好的内容导出成一个 xlsx（三张表），直接交给 Unreal 导入。

使用者不是程序员，所以界面上一切都是中文、表格化、带校验和防呆。
**故意不做节点连线图**——那是开发者的直觉，对策划是灾难。

需求方是策划团队，改动以他们实际使用为准。

## 快速开始

### 策划：双击即用

`release/` 里已经放好了构建产物，不需要安装任何东西：

1. 双击 `release/启动StoryMaker.bat`
2. 浏览器自动打开编辑器，先「新建项目文件」或「打开已有项目文件」
3. 之后每次改动都会自动写回你选定的那个 `.json`（防抖 800ms）

项目内容**只有一份**，就在那个 `.json` 里，本机不缓存副本——换台电脑把 `.json` 拷过去就能接着编。

### 开发者

```bash
pnpm install
pnpm dev          # 开发服务器 http://localhost:5180
```

> 装依赖前先看下面的「注意」第 1 条。

## 常用命令

| 命令 | 产物 | 用途 |
|---|---|---|
| `pnpm dev` | 开发服务器 :5180 | 开发（`/api` 自动转给本地服务） |
| `pnpm build` | `dist/` 多文件 | 内网服务器 |
| `pnpm build:single` | `release/` | 策划双击即用的单文件产物 |
| `pnpm build:app` | `app-release/win-unpacked/` | Electron 桌面版 |
| `pnpm test` | — | 164 个测试 |
| `pnpm verify:release` | — | 单文件产物自检 |
| `pnpm verify:server` | — | 本地服务自检（真起进程、真发 HTTP、真落盘） |

`pnpm build:single` 会重写 `release/` 下的三个文件，构建完记得提交。

## 数据流

```
剧本（章节 > 段落 > 对话行 / 选项）
  → 对话表（无文本、无选项行）
  → 选项表（含条件、结果、跳转）
  → 本地化表（TXT_ + ID 作 key，中英日）
```

导出的多值列写成 Unreal 数组字面量 `("a","b")`，空列表写空单元格。

两条不能动的设计：

- **uid 与 readableId 分离**：所有引用（跳转目标、选项挂载）都指向 `uid`，`readableId` 只给人看、可以随时重排，所以拖拽排序后引用不会断、本地化文本不会串位。
- **选项独立成表**：跳转目标存在选项上，对话行不带跳转。

## 目录

```
src/core/     数据模型、校验、导入导出、宿主抽象
src/state/    编辑器状态与操作
src/ui/       界面
src/testing/  测试用的假宿主
tools/        导入脚本、构建辅助、本地服务
electron/     桌面版主进程与 preload
testinput/    真实样例（策划的需求总表与 CSV）
release/      单文件产物（构建生成，但纳入版本控制）
```

## 注意

1. **Electron 二进制要手动补下载**。`electron@44` 已移除 `postinstall`，`pnpm install` 不会下二进制，`pnpm build:app` 会报 "Electron failed to install correctly"。国内网络还需要镜像：

   ```powershell
   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
   node node_modules/electron/install.js
   ```

2. **改完前端记得跑 `pnpm verify:release`**，它能挡住「开发正常、打包白屏」那类问题（单文件必须打成 IIFE，`file://` 下浏览器会拒绝执行 module 脚本）。

3. **改了 `release/storymaker-server.ps1` 要跑 `pnpm verify:server`**，`pnpm test` 覆盖不到它。该脚本源文件必须是 CRLF + UTF-8 BOM，否则 Windows PowerShell 5.1 会把中文按 ANSI 解析。

更细的约定（踩过的坑、导出列结构、四个不要动的核心设计）见 [AGENTS.md](./AGENTS.md)。
