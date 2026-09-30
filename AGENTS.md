# AGENTS.md

减少常见 LLM 编码错误的行为准则。根据项目需求与项目特定说明合并使用。

**权衡：** 这些准则偏向谨慎而非速度。对于简单任务，可自行判断。

## 1. 先思考，再编码

**不要假设。不要隐藏困惑。主动暴露权衡取舍。**

在实现之前：
- 明确陈述你的假设。如果不确定，就问。
- 如果存在多种解释，将它们都呈现出来——不要默默选择其中一种。
- 如果有更简单的方法，直说。在有充分理由时提出异议。
- 如果有什么不清楚的地方，停下来，说清楚是什么让你困惑，然后问。

## 2. 简单优先

**用最少的代码解决问题。不写任何猜测性的代码。**

- 不添加超出需求范围的功能。
- 不为只使用一次的代码写抽象层。
- 不添加未被要求的"灵活性"或"可配置性"。
- 不对不可能发生的场景做错误处理。
- 如果你写了 200 行，但 50 行就能搞定，重写它。

问自己："资深工程师会说这过于复杂了吗？" 如果答案是肯定的，就简化。

## 3. 外科手术式的修改

**只触碰你必须改的东西。只清理你自己造成的混乱。**

编辑现有代码时：
- 不要"改进"相邻的代码、注释或格式。
- 不要重构没有坏掉的东西。
- 匹配现有的代码风格，即使你自己会写成不同的方式。
- 如果你注意到无关的废弃代码，提一下就行——不要主动删除。

当你的改动造成了孤立代码时：
- 删除由**你的**改动变得不再使用的导入、变量、函数。
- 不要删除已有的废弃代码，除非被明确要求。

检验标准：每一行被修改的代码，都应该能直接追溯到用户的需求。

## 4. 目标驱动的执行

**定义成功的标准。循环迭代直到验证通过。**

将任务转化为可验证的目标：
- "添加验证" → "为无效输入编写测试，然后让测试通过"
- "修复 Bug" → "写一个能复现它的测试，然后让测试通过"
- "重构 X" → "确保重构前后的测试都通过"

对于多步骤任务，给出简洁的计划：
```
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

强有力的成功标准让你能独立循环迭代。模糊的标准（"让它能跑就行"）则需要不断地澄清确认。

---

**以下情况说明这些准则在起作用：** diff 中不必要的改动减少了，因过度复杂导致的重写减少了，澄清性问题在实现之前就提出来了，而不是在犯错之后。

---

## 额外要求

全程使用中文与用户对话

---

## 提交与推送（每次改完必做）

**每次改动完成后，自动提交并推送到 GitHub，commit message 用中文。**

- 收尾顺序固定：改完 → 跑验证 → `git add` → `git commit` → `git push origin main`。
  验证按改动范围选：碰前端跑 `pnpm test`，碰单文件产物跑 `pnpm verify:release`，
  碰 `storymaker-server.ps1` 跑 `pnpm verify:server`，碰自动更新跑 `pnpm verify:update`。
- **每次提交都要把 `package.json` 的 `version` 往上加**（末位递增，`0.1.0` → `0.1.1`）。
  这个号会被 `pnpm build:single` 写进 `release/version.json`，本地服务只认"远端版本号
  更大"才更新：不加号，策划那边收不到这一版；加了号，本机自己刚构建、还没推上去的
  新版才不会被仓库里的旧版倒着覆盖回去。
- **commit message 必须是中文**，一句话说清「改了什么、为什么」，跟仓库现有风格一致。
  例：`补充 README：项目定位、快速开始与常用命令`
- **只提交这次改动涉及的文件**，不要用 `git add -A` 把无关文件顺手带进去
  （`node_modules/`、临时产物、别人的半成品都不该进）。
- 推送目标是 `origin main`。GitHub 直连不稳定，`github.com:443` 时常连不上，报
  `Connection was reset` 或 `Failed to connect to github.com:443 after 21000 ms`。
- 这台机器用「樱花云」代理上网，端口是 **`http://127.0.0.1:7892`**。它默认以系统代理
  的方式接管（注册表 `Internet Settings` 里 `ProxyEnable=1`、`ProxyServer=127.0.0.1:7892`），
  这种状态下 git 不用任何配置就能推，**所以连不上时先直接重试 `git push`**。
- 直接重试仍通不过，再把这个端口挂给 git（只配本仓库，别动全局）：
  `git config http.proxy http://127.0.0.1:7892`，推完用
  `git config --unset http.proxy` 撤掉——代理软件没开时，写死的代理会让**每一次**
  git 网络操作立刻失败，比直连还糟。
- 端口以实际为准，别照抄 7890 之类的旧值：
  `(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer`
- **推送失败不要静默跳过**：凭据失效或代理没起时，把原始报错贴出来告诉用户，
  不要谎称已上传。
- `pnpm build:single` 会重写 `release/` 下的四个文件（`index.html`、两个启动脚本，
  以及记录各文件 SHA-256、供启动时比对更新的 `version.json`），这是**预期的**——
  `release/` 按仓库约定纳入版本控制，这四个文件要一并提交；漏掉 `version.json`
  自动更新就会拿对不上的哈希去比。

---

# 项目说明：StoryMaker

## 这是什么

一个剧情对话编辑器，给**游戏策划**用，替代他们原来的「Excel 填表 + 表格公式规整」流程。
编辑器里的内容最终导出成 Unreal 导入用的 Excel（一个 xlsx，三张表）。

使用者不是程序员，界面上所有东西都必须是中文、表格化、有校验和防呆。
**不要做节点连线图**——那是开发者的直觉，对策划是灾难。

## 技术栈与产物

Vite + React 19 + TypeScript，导出用 ExcelJS。三种产物共用同一套代码：

| 命令 | 产物 | 用途 |
|---|---|---|
| `pnpm dev` | 开发服务器 :5180 | 开发（`/api` 自动转给同一个本地服务） |
| `pnpm build` | `dist/` 多文件 | 内网服务器 |
| `pnpm build:single` | `release/`：`index.html` + `启动StoryMaker.bat` + `storymaker-server.ps1` + `version.json` | 策划双击即用 |
| `pnpm build:app` | `app-release/win-unpacked/` | Electron 桌面版（绿包目录，不再打单文件 exe） |
| `pnpm test` | — | 164 个测试 |
| `pnpm verify:release` | — | 单文件产物自检 |
| `pnpm verify:server` | — | 本地服务自检（真起进程、真发 HTTP、真落盘） |
| `pnpm verify:update` | — | 自动更新自检（本地 HTTP 冒充远端，不碰真实网络） |

## 项目文件与数据存放（不要改回去）

**项目内容只有一份：用户选定的那个 .json。本机不缓存任何项目数据。**

- 不要重新引入"把项目写进 localStorage 当存档"的做法（`storymaker.project.v1` 已彻底删除）。
  本机只允许记住**上一次开启的文件路径**：桌面版记在 localStorage，本地服务版记在
  `%LOCALAPPDATA%\StoryMaker\session.json`。
- 浏览器页面拿不到磁盘路径，也不允许按路径写文件。所以单文件产物的读写由
  `release/storymaker-server.ps1`（`启动StoryMaker.bat` 启动的本地小服务）代理；
  它只监听 127.0.0.1，页面里带着启动时随机生成的令牌，且**只肯碰它自己记住的那个文件**。
- 启动流程（`src/App.tsx`）：认出宿主 → 按上次路径读回 → 读不回、或压根没记过路径，
  就停在 `src/ui/ProjectGate.tsx` 的门槛页，**必须先「新建项目文件」或「打开已有项目文件」**，
  编辑界面才放出来。改动经防抖 800ms 直接写回那个 .json。
- 宿主抽象在 `src/core/host.ts`：`window.storymakerDesktop`（Electron preload）或
  `window.__STORYMAKER_SERVER__`（本地服务注入的令牌），都没有就返回 undefined。
  测试用 `src/testing/app-harness.tsx` 里的假宿主，不要为了让测试好写而放宽这条。
- 直接双击 `index.html`（没有宿主）时故意只显示引导页，不会退回浏览器本地存储。

## 四个不要动的核心设计

1. **uid 与 readableId 分离**。所有引用都指向 `uid`：跳转目标、选项挂载、对话行的角色与
   显示名（选的是角色的某个别名）、战斗模块的属性 / 技能 / 事件引用，以及指令文本里 `#`
   后面的目标。`readableId`、角色 ID、名称文字这些只是给人看的，随时可以改。所以改 ID、
   改名、拖拽排序之后引用都不会断，本地化文本也不会串位。**只有导出那一刻**才按 uid 查回
   ID / 名字（`src/core/refs.ts`），导出格式一个字都没变。
   读老项目时 `normalizeProject` 会把按 ID / 名字写的引用换成 uid，表里找不到的原样保留
   （交给校验条去报）。**不要在引用字段或指令目标里存 ID / 名字**，那就退回原样了。
2. **选项独立成表**，跳转目标存在选项上，对话行不带跳转。
3. **条件与指令分开**。两者文本格式一样，靠 `CommandDef.category` 区分：
   选项的「出现/可用条件」只能选条件，对话行的指令和选项的「结果」只能选指令。
4. **指令字典驱动下拉**。`CommandDef` 里 `head` 是完整指令头（如 `剧情.演出`），
   `branch` 只是分类说明、**不参与拼装**——拼进去会得到 `剧情.演出.设置表情# …` 这种错误。

## 数据流

```
剧本（章节 > 段落 > 对话行 / 选项）
  → 对话表（无文本、无选项行）
  → 选项表（含条件、结果、跳转）
  → 本地化表（TXT_ + ID 作 key，中英日）
```

`Line.commands`、`StoryOption.appearConditions / enableConditions / results` 都是
`string[]`，统一用 `CommandListInput` 那条「可手写首行 + 水平下拉 + 拖拽排序」的条目式交互。

## 环境坑（踩过的，别重踩）

- **`pwsh` 实际是 Windows PowerShell 5.1**。它的 `-Encoding utf8` 会**写入 BOM**，
  而 harness 的 pnpm 包装器用 `JSON.parse` 读工作目录的 `package.json`，遇 BOM 直接崩。
  写 JSON 请用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`，或用 write 工具。
- **单文件产物必须打成 IIFE**。`file://` 下浏览器会以 CORS 为由拒绝执行
  `<script type="module">`，页面白屏。已加插件剥掉 `type="module"`。
- **剥掉 module 后脚本不再 defer**。Vite 把脚本放在 `<head>`，执行时 `#root` 还不存在。
  `src/main.tsx` 已改成等 `DOMContentLoaded`，不要改回去。
- **绝不要用 `window.confirm`**。它在 Electron 下同步阻塞渲染进程，关掉之后
  页面上所有输入框和下拉框都点不动。用 `src/ui/ConfirmDialog.tsx`。
- **改完前端记得跑 `pnpm verify:release`**。它能挡住上面那类"开发正常、打包白屏"的问题。
- **`tools/server/*.ps1` 必须是 CRLF + UTF-8 BOM**。Windows PowerShell 5.1 读不带 BOM 的
  脚本会按 ANSI 解析（中文全变乱码），而 LF 换行会让 here-string 直接解析失败
  （报 "A 'using' statement must appear before any other statements" 这种莫名其妙的错）。
  `tools/make-launcher.mts` 在往 release/ 拷贝时会统一补上，但源文件本身也得是 CRLF。
- **本地服务的对话框要显式置顶**。系统文件对话框弹出时不会自动成为前台窗口，
  可能躲在浏览器后面，让人以为点了没反应。已用 `Show-DialogOnTop` 处理，别简化掉。
- **改了 `storymaker-server.ps1` 要跑 `pnpm verify:server`**（真起进程、真发 HTTP、真落盘），
  `pnpm test` 覆盖不到它。

## 文件位置

- `testinput/` —— 真实样例：`tb-gal.xlsx`（策划的需求总表）、三个 CSV、`初始数据.json`
- 测试与导入脚本会自动在 `testinput/` → `reference/` → 根目录 里找样例，不要写死根目录
- 导入脚本：`pnpm exec vite-node tools/import-xlsx.mts`（不带参数会自己找 tb-gal.xlsx）

## 导出格式（已和需求方逐列确认）

- 对话表：对话ID / 文本类型 / 角色ID / 角色显示名称 / 强制自动播放 / 文本ID / 选项列表 / 指令列表 /
  可用条件列表 ——**没有跳转列**，也没有「指令」「剧情选项」这两个中间列。
  「角色显示名称」那一格写的是**角色表里那个名称的文本 key**
  （选默认名称 → `TXT_<角色ID>_DefaultName`；选别名 N → `TXT_<角色ID>_OtherName-N`），
  中文不直接进这一列（跟「文本ID」列一个套路）
- 选项表：选项ID / 选项文本 / 出现条件列表 / 可用条件列表 / 结果列表 / 下一对话ID
- 角色表（剧情那一张，别和战斗的「GAS角色」搞混）：角色ID（行名）/ 播放位置 / 显示名称 / 表情差分列表。
  播放位置直接写中文（剧情对话框 / 战斗对话框 / 屏幕中间，默认剧情对话框）；
  「显示名称」那一格写**默认名称的文本 key**（`TXT_<角色ID>_DefaultName`），别名不进这张子表
- 本地化表：key / 中文 / 英文 / 日文。除了对话与选项文本、UI 文案，还收角色名与别名
  （中文与英文日文都挂在角色表那一行 / 别名上）
- 多值列写成 Unreal 数组字面量 `("a","b")`，空列表写空单元格（不是 `()`）

## 需求来源

需求方是策划团队，改动都以他们实际使用为准。
有疑问**先问**，不要自己拍板——尤其涉及导出列结构、ID 规则、指令语义时。