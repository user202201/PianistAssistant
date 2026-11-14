# Pianist Assistant 代码地图（给以后的开发者 / AI 看）

> 目的：不用重新通读 12000 行代码就能知道「东西在哪、怎么实现、改哪里要同时改哪里」。
> 行号会变，**以函数名为准**（`grep -n "function 名字" src/main.ts`）。
> 维护规则（见 `CLAUDE.md` 第 13 条）：新增 / 删除模块、路由、设置项、存储键、工作流时，同一次修改里更新本文件。
> 最后核对：2026-11-14（commit 之后的 `claude/epic-dirac-38xck6`）。

---

## 1. 一句话概览

钢琴练习用的 **PWA**：读 MusicXML 乐谱 → OSMD 画谱 → smplr 播放 → 光标跟随；有指法、四手联弹分屏、PDF 查看 + 手写批注、简谱、
隐藏的「游戏模式」（下落音符 + MIDI/麦克风计分）。乐谱存在用户**自己的私有 GitHub 仓库**（网页版）或**设备本地 IndexedDB**（设备模式 / 商店 App）。
PDF / 照片转乐谱由用户私有仓库里的 GitHub Actions 完成（Audiveris / homr）。同一份代码打成：GitHub Pages 网页、Capacitor 的 iOS / Android / 鸿蒙包。

技术栈：Vite 8 + TypeScript（无框架，手写 DOM 助手 `h()`），`opensheetmusicdisplay`、`smplr`、`pdfjs-dist`、`fflate`、`qrcode`；测试 Playwright。

## 2. 目录

| 路径 | 内容 |
|---|---|
| `src/` | 全部应用代码（见 §3、§4）|
| `src/style.css` | **唯一**样式文件（约 970 行），用 CSS 变量做亮 / 暗 / 游戏主题 |
| `index.html`、`public/` | 入口、图标、隐私政策 `public/privacy/index.html` |
| `vite.config.ts` | 构建开关（§7）、PWA 配置 |
| `tests/` | 端到端测试（§8）；`tests/e2e/NN-name.cjs`，清单 `tests/suites.txt` |
| `scripts/` | `check-i18n.mjs`、`make-scores-repo-bundle.sh`、OCR 实验脚本、`sound-sizes.sh` |
| `scores-repo-template/` | 用户私有「乐谱仓库」的模板：`convert.sh`、`.github/workflows/convert.yml` 等；`scores-repo-bundle.zip` 是它的打包副本 |
| `mobile/` | Capacitor 配置、`build-android.sh`、`build-ios.sh`、`fetch-sounds.sh`、`ios-store/`（Swift 原生插件）|
| `packages/` | 各平台安装说明（给用户）|
| `docs/` | `MAINTAIN.md`（自己维护指南）、`SECURITY.md`（安全检查记录与已知风险）、`NEXT.md`（接着做什么）、`TODO.md`（想法清单）、`fingering-logic.md`（指法算法，改 `fingering.ts` 必须同步）、`going-private/`（用户自助指南）、本文件 |
| `.github/workflows/` | 见 §9 |

## 3. 模块地图（`src/`）

### 3.1 入口与界面：`main.ts`（约 3450 行，最大的文件）
没有组件框架：`h(tag, props, ...children)` 创建 DOM；`ic(name,size)`（来自 `icons.ts`）创建图标；`toast(msg, ms, working)` 顶部消息条。
全局状态：`settings`（`loadSettings()`）、`ctx`（AudioContext，`audioCtx()` 惰性创建）、`renderSeq`（渲染令牌，异步渲染完成时用 `stale()` 判断是否已被新页面取代）。

**路由**（`route()`，监听 `hashchange`）：

| hash | 函数 | 页面 |
|---|---|---|
| `#/`（默认）| `renderHome()` | 主页：欢迎卡、转换队列、配对建议、「最近打开」、标签栏（全部 / 收藏 / PDF / 四手…）、列表 |
| `#/score/<name>` | `renderPlayer(name)` | 单份乐谱播放页 |
| `#/duet/<a>/<b>` | `renderDuet(pair)` | 两个文件合成的四手联弹（分屏）|
| `#/pdf/<name>` | `renderPdf(name)` | PDF 查看 + 批注 + 自动翻页 |
| `#/link/…` | `signInFromLink()` | 扫码 / 链接登录 |
| 未登录且非本机模式 | `renderLogin()` | 登录页 |

打开乐谱前 `mayOpenScores()` 检查试用 / 解锁（仅 iOS 商店版有限制，见 `entitlement.ts`）。切页前 `cleanup()` 清理定时器、播放器（`disposePlayer`）。

**main.ts 里的主要块**（按出现顺序）：
- 工具：`h`、`toast`、`marquee`（长名字滚动）、`popup`、`askText`、`openCardMenu`（卡片「更多」菜单）、`showError`。
- 声音：`getInstrument(id,onStatus)`（smplr 乐器加载）。
- 登录 / 付费：`renderLogin`、`showPaywall`、`buyUnlock`、`restoreUnlock`（调用 `entitlement.ts`）。
- 设置：`openSettings(onSound?, onLayout?, scrollTo)` —— 大对话框；开关切换会重建但保留滚动位置。含「存储 / 备份」（`exportBackup`/`importBackup`）、「GitHub 与 PDF 转换」、`openFeedback`、`showQr`。
- PDF 转换流程：`canConvert()`、`noticePdfOnly()`（转换关闭时的一句提示）、`askPdfMode()`（`#pdf-mode`/`#pdf-engine`/`#pdf-go`）、`engineRow()`、`relayConvert()`、`ensureConvertYml()`/`askCreateConvertYml()`、`openGithubSetup()`、`openConvertHelp()`、`openConnectConversion()`、`showUsage()`、`askConflict()`（同名处理）。
- 四手配对：`openPairDialog`、`duetHash`、`pairKey`、`dismissPair`（建议逻辑在 `pairs.ts`）。
- 隐藏游戏模式入口：`onLogoTap`（点左上角音符 10 次）、`modeToggle()`（乐谱页「练习 / 游戏」开关）、`applyGameTheme()`。
- 主页：`renderHome()`（自己约 650 行：上传循环 `for (let f of picked)`、标签、排序菜单、搜索、收藏、最近、队列轮询 `homeTimer`）。
- 播放页：`renderPlayer`（OSMD 初始化、`extractScore`、`Player`、指法工具）、`renderDuet`（两个 OSMD 视图 + `mergeScores`）、`syncView`/`systemExtents`（分屏时按行同步）。
- **`buildControls(player, score, views, status, tools, files)`**（约 770 行）：底部控制条和一切播放页行为，单份与四手共用。内部函数分组：
  - 播放键：`playBtn`/`stopBtn`/`miniPlay`；手选择 `handBtn`/`setHands`/`partControls(g)`（四手每声部一条）；练习面板 `applyPractice`（循环、渐快）；缩放 `zoom`；`relayout`/`rerender`。
  - 指法：`fingerBtn`、`setFingers`、`enterEdit`/`exitEdit`/`syncEdit`；对齐小节 `alignBtn`/`setAlign`（`alignRules`）。
  - 光标跟随：`followOne`/`scrollToCursor`/`updatePeek`/`syncViews`/`followView`；点谱跳转 `tapTargets`/`seekFromTap`；预备拍 `showCountIn`。
  - 底栏模式：`barMode`/`setBar`/`refreshMore`（full / min / hidden）。
  - **游戏模式**（同函数内）：`gv = createGameView(...)`、`hud = createHud(...)`、`gs`（`GameScore`）、`handleKey`/`micHandler`、`beginRound`、`simulate`（演示的"假玩家"）、`syncGame()`（根据设置显示 / 隐藏游戏面板，设 `html.gamecompact`，清理）、`wakeUi`/`topPoll`（浮动按钮闲置变淡、横屏播放时顶栏自动隐藏）。
- `renderPdf`：pdf.js 渲染、`NoteBook`/`PageLayer` 批注、`AutoTurn` 自动翻页、全屏 `setFull`、工具条显示 / 隐藏。
- 更新：`hardRefresh`、`checkUpdate`、`showUpdateBanner`（Service Worker，`registerType: "prompt"`，播放 / 编辑时不重载）。
- 末尾：`startErrorLog(); route();`。

### 3.2 数据层：`api.ts`（约 850 行）—— **UI 只能通过它读写数据**（CLAUDE.md 规则 4）
- 两个后端、同一接口：GitHub 仓库（REST，细粒度 token，默认仓库 `<用户>/PianistScores`）与本机 IndexedDB（`isLocal()`/`useLocal()`/`leaveLocal()`，键 `pianist.storage`）。底层 `list / getBytes / put / remove / exists` 按模式路由。
- 目录（仓库或本机相同）：`scores/`（MusicXML）、`pdfs/`（PDF）、`inbox/`（待转换的 PDF / 图片，含 `<file>.engine.txt`、`.failed.txt`、`.retry.txt`）；配置文件：配对、收藏、PDF 批注（`readPairs/writePairs`、`readFavs/writeFavs`、`readPdfNotes/writePdfNotes`）。
- 乐谱 / PDF：`listScores`、`downloadScore`、`uploadScore`、`saveScoreText`、`putScoreText`、`renameScore`、`deleteScore`、`listPdfs`、`storePdf`、`downloadPdf`、`deletePdf`、`prefetchLibrary`（离线副本）、`cleanName`、`looksLikeMusicXml`。
- 登录：`login`、`getAuth`、`logout`、`makeLoginLink`/`parseLink`（二维码）。错误类：`AuthExpired`、`ApiError`、`NoActionsPermission`、`ConvertFailed`；`isOffline()`。
- **转换**：
  - 仓库模式：PDF 放进 `inbox/` → 用户仓库里的 `convert.yml` 运行 → 结果出现在 `scores/`；`listInbox`、`queuedSince`、`retryConversion`、`readFailureLog`、`convertStoredPdf`。
  - 设备模式「中转」：`connectConversion`/`getConvAuth`/`clearConvAuth`/`convTarget`、`hasConvertYml`（按仓库缓存）、`convertViaRepo(name,data,engine)`（唯一名 `relay<ts>-name`，先写引擎说明，轮询 `RELAY_WAIT` 每 8 秒最多 25 分钟，取回后清理）、`saveConverted`、`conversionUsage`。
  - `OcrEngine`：`audiveris` | `homr`（oemer / both / all 已从界面移除，加载设置时归一为 audiveris）。
- 商店版（`__LOCAL_ONLY__`）：`getConvAuth()` 返回 null，`login()` / `connectConversion()` / `need()` 直接抛错，`#/link/` 登录链接无效，界面不含 GitHub / 转换。

### 3.3 乐谱解析与播放
- `score.ts`：`toMusicXml(buf)`（.mxl 解压，只解 container.xml 和 .xml/.musicxml，单条最大 50 MB；纯 XML）、`extractScore(osmd,title)` → `ParsedScore`（`events: NoteEvent[]` 含 `sec/dur/midi/part/staff/step/measure/onset/vel/dur0`，`steps`、`duration`、`baseBpm`、`timeSig`）、`mergeScores`（四手）。
- `expression.ts`：`applyExpression(score, xml)` 把力度 / 渐强渐弱 / 断奏 / 踏板转成 `vel` 和时值。
- `player.ts`：`Player`（Web Audio 前瞻调度 `LOOKAHEAD`、速度、`partOn`/`partHands`、节拍器、预备拍、循环 `loop`、渐快 `ramp`、`practiceMute`、`position()`、`isShown(e)`、`onChange`；`osmd` 为 null 时由屏幕自己跟时钟——四手分文件）。
- `audio.ts`：`SOUNDS`（smplr 预设；`__MOBILE__` 时只留打包进 App 的）、`clickSound`、`createSynth`、`unlockIOSAudio`。
- `musicxml.ts`：轻量 MusicXML DOM 读写（`walkNotes`、`setFingering`、`noteKey`、`serialize`）；二谱表声部每谱表一只手。
- `jianpu.ts`：`addJianpu(xml)` 把简谱数字作为歌词写进**绘制用的副本**；`setupJianpu`（`LyricsHeight` 必须在 `load` 之前设）；`drawDots` 用 SVG 画八度点（第一阶段，无时值）。
- `pairs.ts`：按文件名猜 Primo/Secondo、A/B、(1)/(2)、上 / 下，只给**建议**。

### 3.4 指法
- `fingering.ts`：`suggest(notes, fixed)` 纯规则（单线动态规划 + 和弦指法表）；已有指法永不改。**算法文档 `docs/fingering-logic.md` 必须同步改。**
- `fingerui.ts`：`FingerTools`（在 OSMD 画面上叠层显示 / 编辑指法，保存回 MusicXML）、`FingerGroup`（四手两个视图）、`FingerApi` 接口。

### 3.5 PDF
- `pdfnotes.ts`：`NoteBook`（笔画存储，坐标按页宽高归一化 0..1，按页保存）、`PageLayer`（每页透明 canvas，Pencil 压力、笔 / 荧光笔 / 橡皮）、`parseNotes`。
- `autoturn.ts`：`AutoTurn` 每 N 秒自动翻页。
- `imgpdf.ts`：`imageToPdf`/`jpegToPdf` 把照片包成一页 PDF（之后按 PDF 流程走）。

### 3.6 游戏模式（隐藏，点音符 10 次开启）
- `gameview.ts`：`createGameView(player, score, opts)` —— 下落音符 + 键盘的 canvas 面板（`.gamepanel`）；平面 / 3D 倾斜；可拖高度（`MIN()`、`maxH()`、`defH()`，小屏更矮）；`kh0` 键盘高度（小屏 / 横屏更矮）；按钮：模式开关（演示 / 计分）、`.gfull`（不看谱全屏，`html.gamefull`）、`.gtilt`；`press/release/judge/milestone/refit/setTilt/setScoring/destroy`。
- `gamescore.ts`：纯逻辑 `GameScore`、`WINDOWS`（Perfect / Good / Early / Late 窗口，easy / normal / hard）、`Judgement`、`isComboMilestone`。
- `gamehud.ts`：`createHud`（`scoreBox`、`comboBox`、`chip`、`setup` 连接卡、`result` 总结卡、延迟补偿、麦克风灵敏度）。
- `midi.ts`：`MidiInput`（Web MIDI；iOS App 用原生插件 `PianistMidi`）。`mic.ts`：`MicInput`（只检测「此刻该弹的音」，`MIC_THRESHOLDS`）。
- `gamesound.ts`（READY / GO 合成音）、`confetti.ts`（解锁烟花）。

### 3.7 其他
- `settings.ts`：`Settings` 接口 + `loadSettings/saveSettings`（键 `pianist.settings.v1`）；另有 最近打开 / 收藏 / 新增 / 排队时间 / 已看 等 localStorage 小表（`getRecent`、`getFavs`、`markOpened`、`markQueued`、`isNew`…）。
- `i18n.ts`、`i18n-data.ts`：见 §6。`fit.ts`：`startFitting()` 长文本 / 小屏自适应（缩字 → 收紧 → 图标 → 下拉）。`icons.ts`：线条图标集。
- `entitlement.ts`：iOS 商店版 14 天试用 + 一次性买断（`PianistStore` 原生插件；无插件 = 永不锁定）。`errlog.ts`：本机错误日志（最近 30 条，已脱敏，随反馈邮件可附）。`convertyml.ts`：`?raw` 导入 `convert.yml`，生成 GitHub「新建文件」预填链接。
- `pwa-stub.ts`：移动构建里替代 Service Worker 注册。`*.d.ts`：类型声明与构建常量（`__BUILD__`、`__MOBILE__`、`__LOCAL_ONLY__`、`__FEEDBACK_EMAIL__`）。

## 4. 样式（`style.css`）约定
- 变量：`--bg --surface --bar --fill --sep --text --muted --accent`；暗色 `@media (prefers-color-scheme: dark)` 与手动主题；游戏主题 `:root[data-game="1"]`（荧光蓝），游戏模式开启 `data-gamemode="1"`。
- 状态类（挂在 `html` 或 `#app` 上）：`gamecompact`（四手游戏：声部栏变悬浮圆按钮）、`gamefull`（只看琴键）、`ctlidle`（浮动按钮淡出）、`autohidetop`+`topshow`（横屏播放顶栏隐藏）、`focusing`（一个声部全屏）、`pdffull`。
- 响应式：`≤920px` 主页整页滚动、标签栏 sticky；`≤700px / 高 ≤480px` 小屏压缩；`≤560px` 头部换行（标题独占一行）；平板（≥744px）卡片更大。

## 5. 数据与存储键（localStorage，均以 `pianist.` 开头）
`settings.v1`、`auth.v1`（GitHub token + 仓库，可选择只在会话内）、`conv.v1`（设备模式的中转仓库）、`storage`（本机 / GitHub）、`recent.v1`、`opened.v1`、`seen.v1`、`new.v2`、`queued.v1`、`favs.v1`、`home.tab`、`pair.dismissed`、`welcome.v1`、`alignhint.v1`、`tap.hint`、`game.unlocked.v1`、`errlog.v1`。

## 6. 多语言（CLAUDE.md 规则 1）
UI 文字在代码里写**中文**，其他语言在上屏时翻译（`i18n.ts` 遍历文本节点 / title / placeholder / confirm）。表在 `i18n-data.ts`（`EN FR DE JA KO`，以中文原文为键，带变量用 `{0}`）。
新增 / 修改文字 → 五个表都要加；`npm run check:i18n`（`scripts/check-i18n.mjs`，用 TypeScript AST 扫描 `src/*.ts` 里所有含汉字的字符串，`i18n-data.ts` 与 `pairs.ts` 除外）缺一即失败。抛出的错误信息里的中文也要有条目。
布局套件 `tests/e2e/37-layout-{en,fr,de,ja,ko}.cjs`（共用 `37-layout-lib.cjs`）检查平板和 360px 手机上无溢出 / 裁切 / 重叠，并保存截图，新页面要看截图。

## 7. 构建与平台开关（`vite.config.ts`）
| 变量 | 含义 |
|---|---|
| `BASE_PATH` | 网页路径，默认 `/PianistAssistant/`；测试 / 检查用 `/` |
| `MOBILE=1` | App 构建：相对路径、无 Service Worker、输出 `dist-app/`、`__MOBILE__=true` |
| `LOCAL_ONLY=1` | 商店版：无账号 / GitHub / 转换（`mobile/scripts/build-*.sh` 默认设置）|
| `FEEDBACK_EMAIL` | 反馈邮件地址（仓库变量），空 = 隐藏该功能 |
| `PAYWALL=1` | 打开 14 天试用 + 买断（`__PAYWALL__`，默认关闭；dev server 恒开，给测试用）；`build-ios.sh` 同时决定是否带原生购买插件 |
| `BUILD_ID` | 「当前版本」时间戳 |
`securityMeta` 插件：只在网页版生产构建里写入内容安全策略（CSP）和 `referrer: no-referrer`；改动联网的服务器清单时必须同步改 `connect-src`（见 `docs/SECURITY.md`）。
提交前必跑：`npx tsc --noEmit && npm run check:i18n && BASE_PATH=/ npx vite build`。

## 8. 测试
- `bash tests/run-all.sh [套件名…]`：无参数 = 全部（约 25 分钟，会 `rm -rf tests/out`、自启 vite 于 5173，**不要同时跑两个，运行期间不要改 src**），另跑 `tests/shell/convert-script.sh`（假引擎测 `convert.sh`）、`store-build-no-relay.sh` 和 `build-security.sh`（构建出网页版 + 商店版后检查 CSP、注入脚本被拦、商店版登录链接无效）。失败的套件自动重试一次。
- 每个套件 = `tests/e2e/NN-名字.cjs`，以 `require('./harness.cjs')` 启动**假 GitHub**（内存 `Map`，键如 `scores/x.musicxml`）。`harness.start(store, opts)` 选项：`local`、`pdfConvert:false`、`noConvertYml`、`actionsRuns`、`actionsStatus`、`locale`、`init`、`context`（viewport 等）。默认初始化脚本把 `pdfConvert` 设为 true，并自动回答 PDF 对话框（设 `window.__noAuto=true` 关闭）。夹具在 `tests/fixtures/`，输出与截图在 `tests/out/work/`。
- 规则：新功能 / 修复必须有套件，且**在旧代码上会失败**。已编号 1–76（`tests/suites.txt`）。新近：72 PDF 转换开关、73 convert.yml 与照片、74 主页标签栏吸顶、75 游戏小屏（头部、淡出、琴键高度、横屏隐藏、仅琴键、按钮不重叠）、76 解压炸弹。
- 做不了的：真 iPad / iPhone、真钢琴声音与麦克风、真 Apple / Google 账号、真 homr / Audiveris（由 OCR 实验工作流测量）、WebKit（`webkit.yml` 从未跑出结果）。

## 9. 工作流（`.github/workflows/`）
`check.yml`（每次推送：类型 + 翻译 + 构建，约 2 分钟）、`deploy.yml`（推送即发布 GitHub Pages）、`tests.yml`（手动全套）、`mobile.yml`（每天 UTC 20:11 + 手动，手动可勾选 `with_github` 出带 GitHub 转换的自用包（文件名 `-github`）：先跑全部网页测试，通过才打 Android / iOS / 鸿蒙包，发布到 Release `app-builds`）、`webkit.yml`（Safari 引擎抽查，不挡打包）、`sound-sizes.yml`、`ocr-lab.yml` / `ocr-lab-deep.yml`（用已知乐谱做 PDF 转换质量对比）、`ocr-real.yml`（每晚真实 PDF 测量）。
用户私有乐谱仓库里（模板在 `scores-repo-template/`）：`convert.yml`（`inbox/` 有新文件即转换；克隆公开仓库的脚本；引擎缓存 `$ENGINE_CACHE`，`AUDIVERIS_VERSION`）、`lab.yml`（私有对比实验）。改 `scores-repo-template/` 后运行 `scripts/make-scores-repo-bundle.sh` 更新 `scores-repo-bundle.zip`。
转换质量结论（`CLAUDE.md` 规则 8）：Audiveris 对干净 PDF 近乎完美；homr 在扫描件上最好；oemer 全部失败已隐藏；许可证：homr AGPL-3.0、Audiveris AGPL，均不适合内置到商店 App。

## 10. 关键流程速查
1. **上传**（主页 `renderHome` 上传循环）：乐谱 → `api.uploadScore`；PDF / 照片 → 先 `imageToPdf`（照片）→ 转换关闭：`noticePdfOnly` 后只存 `pdfs/`；开启：`askPdfMode` → `ensureConvertYml`（仓库模式）→ 放入 `inbox/`，或设备模式 `relayConvert` → `convertViaRepo`。
2. **打开乐谱**：`route` → `mayOpenScores` → `renderPlayer` → `api.downloadScore` → `toMusicXml` → OSMD `load/render` → `extractScore` → `applyExpression` → `new Player` → `buildControls`。
3. **四手**：`renderDuet` 读两个文件，两个 OSMD 视图，`mergeScores` 合并事件，`Player(osmd=null)`；`splitwrap`/`pane`/`panehead`；游戏模式下 `gamecompact`。
4. **游戏计分**：`GameScore` 持有应弹的音；`handleKey`（MIDI 或麦克风）→ `gs.strike(note, t)`（减去延迟补偿）→ `judged` → `gv.judge` + `hud.judged`；`roundTimer` 每 60ms `gs.advance(pos)` 标记漏音；结束 `hud.showResult`。
5. **隐私**：除登录 GitHub、用户自己的仓库、smplr 音色下载外，没有任何外发；错误日志只在用户写反馈邮件时可附。

## 11. 已知未做 / 待用户决定
见 `docs/NEXT.md` 与 `docs/TODO.md`：关闭 App 后恢复中转转换（第 2 步）、简谱第二阶段（时值）、游戏成绩保存、触摸键盘、清除 git 历史里的版权 PDF（需强制推送并经用户同意）、是否保留 homr + Audiveris「对比」模式、iPad 真机验证路线。
