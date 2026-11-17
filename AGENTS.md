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
  验证按改动范围选：碰前端跑 `pnpm test`，碰打包或自动更新跑 `pnpm verify:app-update`。
- **每次提交都要把 `package.json` 的 `version` 往上加**（末位递增，`0.1.0` → `0.1.1`）。
  这个号会由 `pnpm build:app` 写进 `app-update/version.json`，客户端只认"远端版本号更大"
  才更新：不加号，策划那边收不到这一版；加了号，本机刚构建、还没推上去的新版才不会被
  仓库里的旧版倒着覆盖回去。
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
- `pnpm build:app` 会重写 `app-update/version.json`、`app-update/app.asar` 和 `app-update/changelog.json`，
  这是**预期的**——这三个文件按仓库约定纳入版本控制，必须随版本一起提交；漏了客户端就拉不到新版或看不到更新内容。

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
| `pnpm build:app` | `app-release/win-unpacked/` + `app-update/` | Electron 桌面版（**唯一交付方式**） |
| `pnpm test` | — | 657 个测试 |
| `pnpm verify:app-update` | — | 自动更新自检（版本比较 / 清单校验 / 双源兜底 / 哈希） |

## 打包（统一走 `pnpm build:app`）

对外交付一律用 `pnpm build:app`，产物是 `app-release/win-unpacked/`（绿包）+ `app-update/`（自动更新用），
双击 `StoryMaker.exe` 即用。`pnpm build` 只用于内网多文件部署；单文件产物已弃用，见本节末尾。

固定流程：

1. **对齐依赖**：看 `node_modules/.modules.yaml` 里的 `packageManager` 是否与当前 pnpm 大版本一致。
   不一致时 pnpm 会在每个脚本前试图删掉 `node_modules` 重装（打包会奇慢）。有空就先跑一次
   `pnpm install` 对齐（会重新链接、按需下载，几百 MB）；赶时间可以不管，它会中止重装并继续，
   只是每条命令都多花几秒。
2. **清缓存**：删 `app-release/`、`dist/`、`tsconfig.tsbuildinfo`、`node_modules/.vite`。
   **不要清** `%LOCALAPPDATA%\electron-builder\Cache`：electron、7zip、winCodeSign 都在里面，
   清了会重新走 GitHub 下载，只会更慢。
3. **执行**：`pnpm build:app`（`tsc -b` → `vite build` → `electron-builder --win` →
   `tools/make-app-update.mts`），本机干净构建约 30 秒。**打之前先在 `CHANGELOG.md` 给当前版本写条目**：
   脚本会把它转成 `app-update/changelog.json`，当前版本没写会直接失败。
4. **验证产物**：`resources/app.asar` 约 1.4 MB / 11 个条目；exe 的 `FileVersion` 等于 `package.json`
   的 `version`；`app-release` 总量约 370 MB（electron.exe 独占 246 MB）；
   `app-update/version.json` 的 `version` 与 `package.json` 一致、`sha256` 与 `app-update/app.asar` 对得上；
   `app-update/changelog.json` 里能找到当前版本那一节。
5. **启动自检**：起 `win-unpacked/StoryMaker.exe`，等主窗口出现：冷启动 2–3 秒、热启动 0.4 秒内算正常。

注意事项：

- `build.files` 里有 `!node_modules/**/*`：前端依赖全由 Vite 打进 `dist/` 的 bundle，
  **不要把 node_modules 打回 asar**（会白涨 37 MB）。
- electron-builder 在 Windows 上通过 PowerShell 调 `pnpm list --json` 收集依赖，所以 PATH 里必须有
  `pnpm` 可执行入口；只有 `pnpm.mjs` 时它会拿到空输出，报 `No JSON content found in output`。
- 终端里若注入了 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 会退化成 Node、开窗即退；自检前先清掉它。
- **发版必须把 `app-update/version.json`、`app-update/app.asar`、`app-update/changelog.json` 一起提交**，
  漏了客户端就拉不到新版或看不到更新内容。`app-update/` 纳入版本控制。

### Electron 自动更新（只换 app.asar）

设置页有「版本与更新」：显示 `当前版本 vX`、手动「检查更新」、发现新版后「下载更新 / 重启并安装」。
启动 3 秒后主进程会在后台查一次，有新版就通过 `update:available` 推给界面弹提示；
连不上更新源就静默跳过，绝不影响使用。

- 更新源：`raw.githubusercontent.com/.../main/app-update`，失败再试 `cdn.jsdelivr.net/gh/...@main/app-update`。
  仓库必须保持 **public**（私库要 token，不能放进客户端）。可用 `STORYMAKER_APP_UPDATE_BASE`（逗号分隔）覆盖。
- 清单 `app-update/version.json`：`version` / `file`（只认 `app.asar`）/ `sha256` / `size`。
- 更新日志 `app-update/changelog.json`：由根目录 `CHANGELOG.md` 生成（`## 版本号` + `- 条目`）。
  客户端只取「当前版本之后、最新版本之前」的条目，弹窗和设置页按版本从新到旧展示；
  跨好几个版本时会全部列出，日志取不到就显示「这次更新没有附带更新说明」，不影响更新本身。
  **改了 CHANGELOG 要重新 `build:app`**，否则 changelog.json 还是旧的；当前版本没写条目会直接打包失败。
- 下载到 `resources/app.asar.new`，核对大小与 SHA-256；通过后由一个小 bat 在进程退出后替换 `app.asar` 并重启。
- **exe 不参与更新**：所以 `build.disableAsarIntegrity` 已关掉，避免 exe 里写死的 asar 哈希跟替换后的文件对不上。
  代价是 exe 的 `FileVersion` 会停在安装时那一版，界面里显示的版本来自 asar 的 `package.json`。
- 更新逻辑的纯函数在 `electron/update-core.cjs`，`pnpm verify:app-update` 会起本地 HTTP 源验证双源兜底与哈希校验。
- 首次上线自动更新时，老版本没有更新器，需要手动换一次完整文件夹（之后才会走增量）。

### 单文件产物（已弃用）

`build:single` 已从 `package.json` 删除，`verify:release` / `verify:server` / `verify:update` 一并移除。
**不要恢复这个脚本，也不要手动跑 `vite build --mode singlefile`。** `release/` 下是历史产物，
保持原样，不再重建、不再提交新构建；对外只发 `app-release/win-unpacked/`。
`tools/` 里与单文件相关的脚本（`make-launcher`、`verify-release`、`verify-server`、`verify-update`）
留作参考，不再维护，也不要因为它们去改 `release/`。

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
- **界面主题存在项目文件的 `ui.theme` 里**（跟着项目走：换台机器打开还是同一个颜色），
  本机设置里也留一份，门槛页和还没打开项目时用它。老项目没有 `ui` 时用本机设置，
  在设置页切一次主题就会记进项目文件。
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
   「选项的结果」已经下线：选完要执行一串指令，就让选项跳到那个段落。
3. **条件与指令分开**。两者格式一样，靠 `CommandDef.category` 区分：
   选项的「出现/可用条件」只能选条件，对话行的指令栏只能选指令。
4. **指令字典驱动下拉**。一条指令 = 主指令 + 分支 + 参数列表（`CommandDef.params`）：
   文本写成 `主指令|分支|参数名:值;参数名:值`，参数由字典定义的值来源决定是下拉还是输入框。
   **参数名会进导出文本**（`运算符:=` 里的「运算符」）。字典按主指令分组（模块名在同一页里唯一、
   分支名在同一模块里唯一）。改模块名 / 分支名 / 参数名都必须走 `state/operations` 里的
   `renameCommand*`：它们会把剧情里用到它的指令文本一起改掉，引用才不会断。

## 数据流

```
剧本（章节 > 段落 > 对话行 / 选项）
  → 对话表（无文本、无选项行）
  → 选项表（含条件、跳转）
  → 特殊指令表（主指令=其他、分支=特殊 的指令去重收集）
  → 本地化表（TXT_ + ID 作 key，中英日）
```

`Line.command`、`StoryOption.appearConditions / enableConditions` 都是
`主指令|分支|参数名:值;…` 的指令文本，统一用 `CommandListInput` 那条
「先选主指令 → 再选分支 → 按参数顺序摆控件」的逐级交互填。

## 导入到 Unreal（桌面版）

侧边栏「Unreal」页把导出内容直接灌进打开着的编辑器，走引擎自带的 **Python Remote Execution**：
UDP 组播 `239.0.0.1:6766` 发现节点（`pong` 带回 `project_name` / `engine_root`），TCP 回连后跑一段 Python 拿结果。

- 协议客户端在 `electron/unreal-remote.cjs`，只做发现 / 开通道 / 跑脚本三件事。
  **必须绑 6766 并 `addMembership` 加入组播组**：只往 `127.0.0.1:6766` 发单播 ping 收不到任何回应（实测踩过）。
- 导入编排在 `electron/unreal-import.cjs`：**一条长连接上逐项跑**（`session.openCommand()` 拿通道，
  再 `channel.run(script)` 一项一项来），这样界面能拿到「正在导哪个文件、第几个」。
  不要退回「每次重新握手」或「一次性跑完再返回」——前者慢到没法用，后者没有进度。
- **顺序固定：先素材、后数据表；素材有失败就停下不导表。** 数据表存的是资源引用，
  素材没进去就灌表会让引用指向不存在的资产。
- 增量导入：**素材跟条目 uid 绑定，不跟文件名绑定**（`src/core/imported-assets.ts` 的
  `classifyAssets` 按 ownerUid 索引）。条目 ID 改名时：本地文件跟着改名（`renameAssetFile`）、
  记录判成「改名」、导入时先在 UE 里 `rename_asset` 再导，**不能变成「新建一个 + 旧资产残留」**。
  没改 ID 时才按「路径 + 大小 + 修改时间」判修改/未变。
  记录在 `src/state/import-markers.ts` 的 localStorage `storymaker.unreal.imported.v2`（按素材文件夹分组）。
  「已移除」只提示，**绝不自动删 UE 资产**。数据表永远全量——表小，增量反而容易漏。
  表情立绘的 ownerUid 是「角色 uid + 表情行 uid」，武器图标用武器 uid——**别用 ID 当键**，改 ID 就断。
- 界面侧的纯数据计划在 `src/core/unreal-import.ts`（`buildUnrealImportPlan`）与
  `resolveImportAssets`（把计划对到素材文件上）。图片 / 音效的包路径直接从导出表那一列解析
  （`packagePathOf`），**不要另按分类拼一份**——否则表情立绘那种多一层子文件夹的会分叉。
- 数据表用 `DataTableFunctionLibrary.fill_data_table_from_csv_file` 灌，图片 / 音效用
  `AssetImportTask` + `replace_existing`。CSV 写成**不带 BOM**：UE 的 CSV 解析对 BOM 敏感，
  StoryMaker 自己生成的 CSV 也一直是不带 BOM 的。
- 素材按「文件名（不含扩展名）= ID」精确匹配，大小写不同也算没对上——宁可报错让人改文件名，也不猜着导错资源。
- 脚本在编辑器**主线程同步跑**，导入量大时编辑器界面会卡住；超时给到 10 分钟，不要改小。
- 连哪个工程靠 `pong` 里的 `project_name` 和 `.uproject` 文件名对齐；只有一个编辑器在线时也接受。
- 能力只在桌面版有（`HostApi.unreal` 可选），网页版 / 本地服务版是 `undefined`，界面显示「只有桌面版支持」。
  本机配置（`.uproject` 路径、素材文件夹）存 localStorage 的 `storymaker.unreal.v1`，**不进项目文件**。
- 素材文件夹在**设置页**配（不在 Unreal 页）；`HostApi.unreal` 的 `listAssets / uploadAsset / removeAsset / readAsset`
  是立绘与音效「素材管理」列用的，文件读写全在 `electron/unreal-assets.cjs`。
  上传一律**平铺到素材文件夹根目录**并按 `<ID><原扩展名>` 重命名；同一 ID 只留一份（「…」重选会删旧的）。
  格式收 `png/jpg/jpeg/tga` 与 `wav/ogg/flac`，别的一律拒绝。
- 预览图和音频播放**不走 file://**：主进程把文件读成二进制回来，渲染进程包 Blob。
  tga 浏览器显示不了，「预览」按钮要禁用并说明去 UE 里看。
  **音频一次只播一个**（`src/ui/audio-exclusive.ts`）：播新的先把正在放的 pause 掉。
- 自动收集的「表情立绘 / 武器图标」两张表跟自定义图片同构（ID / 图片分类 / 说明 / 素材管理），
  只读输入框，**没有拖拽**；导出路径不再单独成列，改看「素材管理」。

## 环境坑（踩过的，别重踩）

- **`pwsh` 实际是 Windows PowerShell 5.1**。它的 `-Encoding utf8` 会**写入 BOM**，
  而 harness 的 pnpm 包装器用 `JSON.parse` 读工作目录的 `package.json`，遇 BOM 直接崩。
  写 JSON 请用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`，或用 write 工具。
- **绝不要用 `window.confirm`**。它在 Electron 下同步阻塞渲染进程，关掉之后
  页面上所有输入框和下拉框都点不动。用 `src/ui/ConfirmDialog.tsx`。

## 文件位置

- `testinput/` —— 真实样例：`tb-gal.xlsx`（策划的需求总表）、三个 CSV、`初始数据.json`
- 测试与导入脚本会自动在 `testinput/` → `reference/` → 根目录 里找样例，不要写死根目录
- 导入脚本：`pnpm exec vite-node tools/import-xlsx.mts`（不带参数会自己找 tb-gal.xlsx）

## 导出格式（已和需求方逐列确认）

**类名前缀只在「Unreal 导入设置」里配一处**：设置页先列数据表（表名 / 文件夹 / 子表），
再用一张小表列前缀：一行一条（前缀配置 / 前缀 / 拼出来的样子）——技能表 GA类、
效果表 GE类、属性表 属性类、武器表 武器类、特殊指令表 Command类。
各业务表（战斗的技能页 / 效果页等）只填类名，不再摆前缀输入框；换项目只改设置页这一处。

- 对话表：对话ID / 文本类型 / 角色ID / 角色显示名称 / 强制自动播放 / 文本ID / 选项列表 / 指令 /
  可用条件列表 ——**没有跳转列**，也没有「指令（换行间隔）」「剧情选项（换行间隔）」这两个中间列。
  「角色显示名称」那一格写的是**角色表里那个名称的文本 key**
  （选默认名称 → `TXT_<角色ID>_DefaultName`；选别名 N → `TXT_<角色ID>_OtherName-N`），
  中文不直接进这一列（跟「文本ID」列一个套路）。
  「指令」列是普通文本（跟 文本ID / 角色ID 一个写法），**不是数组字面量**，写法是
  `主指令|分支|参数名:值;参数名:值`（空分支留空段、无参数就空到底，例如：
  `剧情|演出|角色:CHA_西园寺雪;表情:悲伤`、`背包||物品:Item_Coin;运算符:=;数量:100`、
  `剧情|图片|`、`其他|特殊|特殊指令ID:SP_001`、`其他|延时|时长:0.5`）。键值用 `:` 而不是 `=`，
  因为「运算符」的值可能就是 `=`；参数名与值里不能出现 `|` `;` `:` `,` `"` `(` `)`
- 选项表：选项ID / 选项文本 / 出现条件列表 / 可用条件列表 / 下一对话ID
  （「结果列表」已下线：选完要执行指令就让选项跳到那个段落）。
  「下一对话ID」按选项的跳转目标分三种：选了具体对话 / 段落首句 → 那一句的对话 ID；
  「继续对话」（新建选项的默认值，存 `CONTINUE_TARGET = '@continue'`）→ **选项所在那一行的
  ID 尾号 +1**（`Dia_ch01_001-2` → `Dia_ch01_001-3`，导出时现算，插行重排自动跟着走；
  后面没有下一句时照样 +1，校验条会提醒那一句不存在）；「对话结束」→ 留空
- 角色表（剧情那一张，别和战斗的「GAS角色」搞混）：角色ID（行名）/ 播放位置 / 显示名称 / 表情差分列表。
  「播放位置」写位置名，但**角色身上存的是 uid**（角色页顶部的播放位置表里配，改名不用改角色，
  导出时才翻回名字）；「显示名称」那一格写**默认名称的文本 key**（`TXT_<角色ID>_DefaultName`），
  别名不进这张子表。
- 本地化表：key / 中文 / 英文 / 日文。除了对话与选项文本、UI 文案，还收角色名与别名
  （中文与英文日文都挂在角色表那一行 / 别名上），以及武器分组 / 攻击模式 / 插槽的
  **导出名称**（key = 导出名称，中文 = 那一行的显示名称，英文日文存在同一行上），
  还收武器表的**武器名与武器描述**：key = `TXT_WeaponName_<武器ID>` / `TXT_WeaponInfo_<武器ID>`，
  中文就是武器表里那两段文字（在这一页改中文就是改武器表），英文日文存在武器那一行上。
  以上武器相关的条目都在本地化的「武器配置本地化」页：分组 → 攻击模式 → 插槽 → 武器名 → 武器描述。
  还收物品表的**物品名称与物品描述**（在本地化的「物品本地化」页）：key = `TXT_ItemName_<物品ID>` /
  `TXT_ItemInfo_<物品ID>`，中文就是物品表里那两段文字（在这一页改中文就是改物品表），
  英文日文存在物品那一行上。
  还收属性表的**显示文本**（在本地化的「属性本地化」页）：key = `TXT_Attribute_<属性名>`，
  中文就是属性表里那一格（在这一页改中文就是改属性表），英文日文存在属性那一行上；
  显示文本一个字都没填的属性先不列进来。
- 特殊指令表：行名（无标题）/ Command类 / 备注。
  只收剧情里**实际用到**的、主指令是「其他」且分支是「特殊」的指令（「指令」行自己那条），
  同名一行、按第一次出现的顺序；行名取参数「特殊指令ID」的值（取不到就取第一个参数），
  Command类 = 前缀 + `BP_Command_行名.…_C'`
  （前缀存在 `project.specialCommandClassPrefix`，在「Unreal导入设置」里改），
  备注 = 该行的「指令内容」（同名取第一条非空的）
- 图片表：行名（无标题）/ 图片分类 / 备注 / 图片。
  一行一张立绘（图片 ID 空着的不导出）；图片分类写分类名，备注写图片表里那一行的「说明」，
  图片 = `/Script/Engine.Texture2D'<分类存储路径>/<图片ID>.<图片ID>'`。
  分类是立绘页的一张「图片分类」子表（分类名 + 存储路径，默认根
  `/Game/GameContent/Asset/Image`，新分类默认放在 `根/分类名`）；图片行存分类的 uid，
  所以分类改名不会把引用写坏。没选分类（或分类被删了）的图片「图片」列留空，由校验条提醒。
  **表情图片是自动收集的**：角色页勾了哪些表情差分（`Character.expressions`，名字来自全局
  表情表 `project.expressions`），立绘页就有一条图片——ID = `PIC_<角色ID>-<表情标识>`
  （标识 = 表情表里的 `id`，空着用表情名），分类固定挂在标了 `system: 'expressionImages'`
  的「角色立绘」分类下，路径 = `<分类路径>/<角色ID>/<图片ID>.<图片ID>`；这些行接在手填图片后面，
  同 ID 的手填行优先。
  **武器图标也是自动收集的**：每把武器一条 `PIC_<武器ID>`（`src/core/weapon-icons.ts`），
  分类固定挂在标了 `system: 'weaponIcons'` 的「武器图标」分类下（默认路径
  `/Game/GameContent/Asset/Image/WeaponIcon`），路径 = `<分类路径>/<图片ID>.<图片ID>`
  （图标直接放在分类这一层，不按武器分子文件夹）；同样接在表情图片后面。
  立绘模块在界面上分成四个子模块：图片分类 / 自定义图片 / 表情立绘 / 武器图标。
- 音频表：行名（无标题）/ 音频 / 音效类型 / 备注。
  一行一条音效（音效 ID 空着的不导出）；音频 = `/Script/Engine.SoundWave'<类型存储路径>/<音效ID>.<音效ID>'`，
  音效类型写类型名，备注写音效表里那一行的「说明」。
  类型是音效页顶部的「音效类型」表（分类名 + 存储路径，默认根
  `/Game/GameContent/Asset/Sound`，新类型默认放在 `根/类型名`）；音效行存类型的 uid。
  没选类型（或类型被删了）的「音频」「音效类型」两列留空，由校验条提醒。
  图片分类与音效类型是同一套「资源分类」结构（`AssetCategoryRow`），界面共用一张小表。
- 物品表（界面上在「物品」模块）：ID / 物品名称 / 物品描述；导出成「物品」子表时是
  行名（物品 ID）/ 物品名称 / 物品描述。
  「物品名称」列写 `TXT_ItemName_<物品ID>`、「物品描述」列写 `TXT_ItemInfo_<物品ID>`
  （中文在本地化的「物品本地化」页）；物品 ID 空着的行拼不出 key，原样写文字。
- 战斗 GAS属性 表：行名（合成好的 Tag，如 `GAS.属性.生命值`）/ 属性标签
  （`(TagName="GAS.属性.生命值")`）/ 显示文本（`TXT_Attribute_<属性名>`）/ 属性类。
  属性类 = `attributeClassPrefix` + 每行的类名 + `.<类名>_C'`；前缀在「Unreal导入设置」里改
  （默认 `/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/GAS/AS/AttributeBlueprint/`），
  每行类名在属性表里填、新建默认 `BP_GAS_AttributeBase`；拼不出来时写 `None`。
  属性名只在界面与 Tag 合成时用，不单独占一列。
- 战斗 GAS角色 表（角色预设，别和剧情那张「角色」搞混）：行名（角色 ID）/ 角色名 /
  属性列表 / 技能列表 / **武器** / **武器绑定关系**。
  「属性列表」是 `GasCharacter.attributes`：上面一个多选框勾属性，勾上就在下面自动出一行
（属性名 + 数值框，默认 `0`）；数值框右边的下拉可以选另一个属性（`GasPair.sourceKey` 存那个属性的 uid），
选了就表示初始值跟着它走：数值框置灰，显示对方的数。导出格式不变（`((属性Tag,数值),…)`）：
绑定的那一行顺链取最终数字写上（`attributePairValue()`）；链断了或互相成环的行**不导出**，
校验条会报。从多选框里取消一个属性时，别人指向它的绑定也一起清掉。
  「武器」列是 `GasCharacter.weapons`：每条只记一个武器 uid（`WeaponEntry`），界面上按顺序
  **编号从 1 开始**（没选武器的条目不编号、也不占下标）。
  「武器绑定关系」列是 `GasCharacter.weaponBindings`：**每个分组一行**（`WeaponGroupBinding`，同一角色里分组不重复），
  行里按**插槽表里的每一个插槽**各摆一个下拉：下拉里只列「武器」列里已选好的条目，显示为
  `序号 - 武器名`；「这条武器已经在这个分组里」或「这条武器不支持这个插槽」的选项置灰不可选；
  选了武器后，下拉下面出现一排紧凑的单选框（**按攻击模式表生成、只列这把武器支持的**）选攻击模式。
  一条绑定存在 `WeaponSlotMount`（插槽 uid + 武器列条目 uid + 攻击模式 uid）。
  导出两列：「武器」= 按顺序每条武器一个武器 ID（**允许重复**）；
  「武器绑定关系」= 每个装好的插槽一个字符串 `分组|插槽|武器下标|攻击模式`（都用各表的
  导出名称，武器下标从 1 开始，对应「武器」列里的顺序）。两列都是字符串数组。
  没选武器的条目、没选分组的绑定行、没装武器的插槽、以及下标算不出来的安装记录都不导出。
- 战斗 GAS武器 表：行名（武器 ID）/ 武器名 / 武器描述 / 弹匣容量 / 攻击速度 /
  **基础伤害** / **能量消耗** /
  支持攻击模式列表 / 支持插槽列表 / 武器图标 / 武器类。
  「武器名」列写 `TXT_WeaponName_<武器ID>`、「武器描述」列写
  `TXT_WeaponInfo_<武器ID>`（中文在本地化的「武器配置本地化」页）；武器 ID 空着的行拼不出 key，
  原样写文字（校验条会提醒缺 ID）。
  （`GasWeapon` 里没有修改器列表和技能列表了：原来那两列已经删掉，改成「能量消耗」；
  老项目里的 `modifiers` / `skillUids` 读进来直接丢掉，不再校验、不导出。）
  武器页顶部是三张配置表：**武器分组** / 攻击模式 / 插槽（`battle.weaponGroups` /
  `battle.attackModes` / `battle.slots`，都是 `GasOptionRow`：显示名称 + 导出名称 +
  英文日文）。分组默认三条 `火力 → TXT_WeaponTeam_火力`、`光束`、`点防`；
  新加的分组导出名称自动带 `TXT_WeaponTeam_` 前缀。三张表里的行都被武器表与角色预设引用
  （存 uid），删一条时会把引用一起清掉。
  攻击模式 / 插槽两列的数据来自前两张配置表（每行是「显示名称 + 导出名称」，武器里存 uid）：
  支持攻击模式列表写成 `(TXT_AttackMode_手动攻击,TXT_AttackMode_自动攻击)`——**不加引号**，
  逗号分隔；支持插槽列表写成 `("111","222")`——普通字符串数组。两列都写**导出名称**，
  导出名称为空的那一条不写；两列都空时单元格留空。
  「武器图标」列按武器 ID 现算成 `PIC_<武器ID>`（武器表界面上不显示这一列，
  只在导出与立绘模块的「武器图标」页里出现）。
  「武器类」列同样是现算的：`weaponClassName()` 把武器 ID 的 `WEA_` 换成 `BP_Weapon_`
  （`WEA_Test_Sniper` → `BP_Weapon_Test_Sniper`），再补成
  `/Script/Engine.BlueprintGeneratedClass'<前缀><类名>.<类名>_C'`；
  前缀存在 `battle.weaponClassPrefix`（默认
  `/Script/Engine.BlueprintGeneratedClass'/Game/GameContent/BP/Weapon/WeaponActors/`，
  在「Unreal导入设置」里改）。前缀被清空或类名算不出来时这一格写 `None`
  （样例里没有武器类的行就是 `None`）。
- 其余多值列写成 Unreal 数组字面量 `("a","b")`，空列表写空单元格（不是 `()`）
  （对话表的「指令」列除外，见上）

## 需求来源

需求方是策划团队，改动都以他们实际使用为准。
有疑问**先问**，不要自己拍板——尤其涉及导出列结构、ID 规则、指令语义时。