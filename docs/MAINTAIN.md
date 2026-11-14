# 自己维护 Pianist Assistant（不依赖任何人）

这份是给你自己、或者你以后请的开发者 / 任何 AI 助手看的。项目的所有东西都在你的 GitHub 里：代码、自动打包、自动发布、测试。

## 0. 先记住三件事
1. **代码地图**：`docs/ARCHITECTURE.md`（每个文件做什么、路由、存储键、测试怎么写）。**规则**：`CLAUDE.md`（改动前必须遵守的 13 条）。**待办 / 决定**：`docs/NEXT.md`、`docs/TODO.md`。**安全**：`docs/SECURITY.md`。
2. **找别的 AI 或开发者帮忙时，把上面这几个文件一起给他**，他不需要重新读 12000 行代码。
3. 任何改动之前和之后都跑：`npx tsc --noEmit && npm run check:i18n && BASE_PATH=/ npx vite build`（类型、翻译、构建）。

## 1. 在自己的电脑上跑起来
需要：Node.js 22、git。
```bash
git clone https://github.com/user202201/PianistAssistant
cd PianistAssistant
git checkout claude/epic-dirac-38xck6
npm install
npm run dev
```
终端会显示一个本地网址，在浏览器里打开。改 `src/` 里的文件会实时刷新。代码编辑器用 VS Code 打开这个文件夹。

## 2. 改代码之后做什么
| 要做的事 | 命令 / 位置 |
|---|---|
| 检查类型、翻译、能不能构建 | `npx tsc --noEmit && npm run check:i18n && BASE_PATH=/ npx vite build` |
| 跑自动测试（浏览器自动点一遍）| 先 `npx playwright install chromium`，再 `bash tests/run-all.sh 某个套件名`；不带名字是全部，约 25 分钟 |
| 发布网页版 | 推送到 GitHub 的 `claude/epic-dirac-38xck6` 分支，几分钟后 GitHub Pages 自动更新 |
| 看网页版是不是最新 | 网页里：设置 → "当前版本"的时间；不对就 设置 → 强制刷新 |

新增或修改界面文字时，`src/i18n-data.ts` 里五个表（EN FR DE JA KO）都要加，不然 `check:i18n` 会失败，也不能发布。

## 3. 打包手机 App（全部在 GitHub 上点，不需要你的电脑）
GitHub → 仓库 → Actions → **mobile-packages** → Run workflow。
- 默认出**商店版**（纯本机，没有 GitHub 和 PDF 转换）。
- 勾选 **with_github** 出**自用版**（可连接自己的 GitHub 做 PDF 转换，文件名带 `-github`，不要提交商店）。
- 先跑全部网页测试，通过才打包；约 40–60 分钟。
- 结果在发布页：https://github.com/user202201/PianistAssistant/releases/tag/app-builds
- 试用 / 购买默认关闭；要打开收费版本，打包时设 `PAYWALL=1`（见 `packages/ios/README.md`）。
- 每天凌晨也会自动打一次（纯本机版）。

## 4. 装到 iPad
- 免费：Mac + Xcode + 免费 Apple ID，装的 App 7 天后失效，重新用 Xcode 运行一次即可。**Xcode 的版本必须支持 iPad 的系统版本**（iPadOS 26 需要 Xcode 26，Mac 的 macOS 也要够新）。
- 付费（99 美元 / 年）：用 TestFlight，不需要 Mac，版本 90 天有效；步骤和需要填的机密见 `packages/ios/README.md`。
- 装的步骤：下载发布页的 `PianistAssistant-ios-xcode-project(-github).zip`，解压，Xcode 打开 `ios/App/App.xcworkspace`，Signing 里选 Apple ID，把 Bundle Identifier 改成自己的，选 iPad，点 ▶ 运行。iPad 上要开"开发者模式"（要先被 Xcode 识别才会出现）并在 设置 → 通用 → VPN 与设备管理 里信任。

## 5. 出了问题怎么查
- **网页部分**（几乎所有功能）：浏览器开发者工具（F12）的控制台。装在 iPad 上的 App：iPad 设置 → Safari → 高级 → 打开"网页检查器"，Mac 的 Safari 设置 → 高级 → 勾选"显示开发菜单"，数据线连上后在 Safari 菜单栏"开发"里选 iPad 和 App。
- **原生部分**（蓝牙 MIDI、购买）：Xcode 运行时底部的控制台；Swift 代码在 `mobile/ios-store/`。
- **App 自带的错误日志**：设置 → 帮助与反馈，可以把最近的错误附到邮件里（令牌和密钥已自动去掉）。反馈邮件地址来自仓库变量 `FEEDBACK_EMAIL`（仓库 Settings → Secrets and variables → Actions → Variables）。
- **测试失败**：Actions 里点失败的那次运行，下载 `e2e-report`（失败项加截图）。

## 6. 你的 GitHub 里有哪些"设置"（丢了就失效）
- 仓库变量：`FEEDBACK_EMAIL`。
- 仓库机密（只有要签名 / 上传商店时才需要）：`IOS_CERT_P12_B64`、`IOS_CERT_PASSWORD`、`IOS_PROFILE_B64`、`IOS_TEAM_ID`、`ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_P8_B64`、`ANDROID_KEYSTORE_B64` 等（说明在 `packages/*/README.md`）。**安卓的 keystore 丢了就再也不能更新同一个安卓应用，请自己另存一份。**
- 你的私有乐谱仓库（默认 `PianistScores`）：里面的 `scores/`、`pdfs/` 是你的乐谱；`.github/workflows/convert.yml` 是 PDF 转换用的（App 里有一键创建）。令牌是 GitHub 细粒度令牌，只给这一个仓库的 Contents 权限，随时可以在 GitHub 令牌管理里撤销。

## 7. 把问题交给别的 AI / 开发者时怎么说
可以直接复制：
> 这是一个 Vite + TypeScript 的钢琴练习 PWA（Capacitor 打包成 iOS / Android）。请先读仓库里的 `CLAUDE.md`、`docs/ARCHITECTURE.md`、`docs/MAINTAIN.md`，按里面的规则改。改完要跑类型检查、翻译检查和相关的 `tests/e2e` 套件，并为这次改动新增一个测试，且该测试在旧代码上必须失败。问题现象：……（贴报错、截图、操作步骤）

## 8. 现在还没做完 / 需要你决定的事（详见 `docs/NEXT.md`）
- 清除 git 历史里有版权的 PDF（要强制推送，需要你同意）。
- 关掉 App 再打开后接着取转换结果（"中转"第二步）。
- 简谱带时值；游戏成绩保存；触摸键盘。
- 第一次在真 iPad 上测原生 MIDI 和蓝牙（只在云端验证过"能编译"）。
- 找钢琴老师看指法、找德 / 日 / 韩母语者看翻译。
