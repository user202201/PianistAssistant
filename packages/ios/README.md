# iOS（iPhone / iPad）安装与上架（按小白步骤）

## 先说结论

**苹果不允许像安卓那样随便装 App。** 想让 App 出现在 iPhone/iPad 上（哪怕只是自己用），都需要苹果的签名。所以 iOS 这边有两个层次：

- ✅ **现在就能用的办法：把网页版添加到主屏幕**（Safari 打开网页 → 分享按钮 → 添加到主屏幕）。它已经有图标、全屏、离线副本，用起来和 App 很接近，你现在 iPad 上用的就是这种。
- 📦 **真正的 App（.ipa）**：必须有 **Apple 开发者账号（99 美元/年）**。自动打包已经准备好了，等你开通账号、给 GitHub 填好几项机密，每次更新会自动产出可上传的 `.ipa`。

## 你会得到什么

Release 页面（https://github.com/user202201/PianistAssistant/releases/tag/app-builds）里：

- `PianistAssistant-ios-xcode-project.zip` —— 完整的 Xcode 工程（已确认能编译通过）。有 Mac 的话，解压后用 Xcode 打开就能自己签名、装到自己的 iPhone。
- 配置了苹果机密之后，还会多出 `PianistAssistant.ipa`，并可直接发送到 TestFlight。

## 一、开通开发者账号

1. 准备一个 Apple ID（开启双重认证），打开 https://developer.apple.com/programs/enroll/ 按提示注册，付 99 美元/年。个人账号几天内通过。
2. 登录 https://developer.apple.com/account ，在“Certificates, IDs & Profiles”里：
   - **Identifiers → +**：新建 App ID，Bundle ID 填 `com.pianistassistant.app`。
   - **Certificates → +**：新建 “Apple Distribution” 证书，下载后导出成 `.p12` 文件（设一个密码）。没有 Mac 也可以用 openssl 生成证书请求，可以问我，我会一步步带你做。
   - **Profiles → +**：新建 “App Store” 类型的描述文件，选上面的 App ID 和证书，下载 `.mobileprovision`。
3. 登录 https://appstoreconnect.apple.com ：**我的 App → +** 新建 App（名称、语言、Bundle ID 选上面那个）。
4. 在 App Store Connect → 用户和访问 → 集成 → **App Store Connect API 密钥**，生成一个密钥，下载 `.p8`（只能下载一次），记下 Key ID 和 Issuer ID。

## 二、把机密交给自动打包

GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret（文件内容要先转成 base64：Mac/Linux 用 `base64 -i 文件 | tr -d '\n'`）：

| 名称 | 内容 |
|---|---|
| `IOS_CERT_P12_B64` | 证书 `.p12` 的 base64 |
| `IOS_CERT_PASSWORD` | 导出 `.p12` 时设的密码 |
| `IOS_PROFILE_B64` | `.mobileprovision` 的 base64 |
| `IOS_TEAM_ID` | 开发者账号的 Team ID（10 位，在 developer.apple.com → Membership 里） |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_P8_B64` | 第 4 步的 API 密钥（可选，填了就会自动上传到 TestFlight） |

然后到 Actions → mobile-packages → Run workflow。成功后 Release 里有 `PianistAssistant.ipa`；填了 API 密钥的话，App Store Connect → TestFlight 里过几分钟就能看到新版本。

> ⚠️ 这条“签名 + 上传”的流程我**没有办法在没有苹果账号的情况下实测**，脚本是按苹果的标准流程写的。第一次运行如果报错，把 Actions 里的错误日志发给我，我来修。

## 三、测试与上架

1. **TestFlight（自己和朋友测试）**：App Store Connect → TestFlight，添加内部测试员（用 Apple ID 邀请），对方在 iPhone 上装 TestFlight App 就能装你的 App。
2. **提交上架**：App Store Connect → 你的 App → 准备提交：填简介、关键词、截图（iPhone 和 iPad 各需要几张）、**隐私政策网址**、年龄分级、版权信息；选择刚上传的构建版本；点“提交以供审核”。审核一般 1–3 天。
3. **审核提示（已处理）**：苹果审核员没有 GitHub 令牌，所以 App 打开后第一个按钮是“**在本机使用（不需要账号）**”，不用登录就能上传谱子、播放、收藏、备份。**上架版默认是纯本机版：没有账号、没有 GitHub、数据不离开设备，开发者看不到任何用户的曲库**（打包脚本默认 `LOCAL_ONLY=1`）。商店版没有 PDF 转换成可播放乐谱的功能（那需要云端服务），但 PDF 可以保存和查看。

## 没有 Mac 也行吗

可以。上面的打包、签名、上传全部在 GitHub 的 Mac 机器上自动完成，你不需要自己有 Mac。

## 已知限制

- 默认钢琴音色（FluidR3）已打包进 App，离线可用；商店版只提供已打包的音色。
- 谱子目前存在 GitHub 私有仓库，App 里会保留离线副本。

## 上架前自查清单（苹果审核常见问题）

| 项目 | 状态 |
|---|---|
| 不强制登录 | ✅ 默认“在本机使用”，不需要任何账号 |
| 不是“只套了个网页” | ✅ 代码和默认钢琴音色都打包在 App 里，可完全离线使用，有本地文件存储、备份 |
| 加密出口合规 | ✅ 已自动设置 `ITSAppUsesNonExemptEncryption = false`（只用系统自带的 HTTPS） |
| 隐私政策网址 | ✅ 已写好（中/英/法）：`https://user202201.github.io/PianistAssistant/privacy/`（随网页版自动发布，联系邮箱来自仓库变量 `FEEDBACK_EMAIL`）。这份是**你的 App 自己的**隐私政策，必须针对你的 App 写，不能用别人的。如果以后网页版改私有，要把这个页面放到别的地方并更新网址 |
| 技术支持网址（Support URL） | 同上一个网址即可 |
| 联系方式 / 用户反馈 | ✅ 设置里有“帮助与反馈”，会打开用户自己的邮件应用（需要先设置 `FEEDBACK_EMAIL`，见下） |
| 隐私问卷（App Privacy） | 选“不收集数据”（App 没有统计、广告、第三方 SDK） |
| 截图 | ❌ 需要 iPhone 和 iPad 的截图（我可以在模拟器里帮你截） |
| 年龄分级、类别 | 类别选“音乐”；无不适内容 |
| 评审备注 | 写明：“可点‘在本机使用’直接体验；需要乐谱文件可从 samples 下载” |

> 风险提示：苹果有条规定（4.2）不喜欢“只是网站换壳”的 App。我们有离线、本地存储、文件导入导出，通常没问题，但最终由审核员判断，可能被要求补充说明。

## 免费装到自己的设备（不上架）

有 Mac + Xcode 的话，用免费的 Apple ID 就能装到自己的 iPhone/iPad：解压 `PianistAssistant-ios-xcode-project.zip` → 用 Xcode 打开 `ios/App/App.xcworkspace` → 选你的设备 → 在 Signing 里选你的 Apple ID（Personal Team）→ 点运行。免费签名**每 7 天过期一次**，要重新装一遍；也不能用 TestFlight。没有 Mac 就做不到（这是苹果的限制），可以继续用网页添加到主屏幕。

## 设置“帮助与反馈”的收件邮箱

GitHub 仓库 → Settings → Secrets and variables → Actions → **Variables** 标签 → New repository variable：名称 `FEEDBACK_EMAIL`，值填你想收反馈的邮箱。设好后重新打包/部署即可（没设的话，设置里就没有“帮助与反馈”按钮）。邮箱地址会出现在 App 和隐私政策页面里，所以请用专门的公开邮箱，不要用公司或私人邮箱。

## 收费：14 天试用 + 一次性买断

**谁判断什么？** 钱和收据由 App Store 管（Apple 收款、给你打款、处理退款、家人共享）。App 里只需要问“这台设备的 Apple ID 买过解锁吗？”和“这个 App 是哪天第一次下载的？”。
这两件事都在手机上由 StoreKit 回答，**不需要我们的服务器，也不会把任何信息发给我们**（和“商店版纯本机”一致，隐私政策不用改）。

**为什么 14 天要 App 自己数？** App Store 自带的免费试用只支持“订阅”。买断（一次性）没有自带试用，所以做法是：
免费下载 → App 数 14 天（起点 = Apple 记录的首次下载日期，卸载重装不会重新计时）→ 到期后打开乐谱会弹出“解锁完整版”，
乐谱库、设置、备份导出仍然可用（用户的数据不会被锁住）。代码：`src/entitlement.ts`（逻辑）、`mobile/ios-store/`（原生 StoreKit 2），测试：`tests/e2e/33-trial-purchase.cjs`。
只有 iOS 商店版带这套逻辑；网页版、安卓、鸿蒙没有试用，不会被锁。

### 你要做的（都在 Apple 网站上，约 30 分钟，外加 Apple 审核银行/税务资料的等待）
1. **付费 App 协议、银行、税务**：App Store Connect → 业务（Business）→ 协议、税务和银行业务 → 签署“付费 App”协议，填银行账户和税表。不做这一步，内购无法上线。
2. **小型企业计划（可选但建议）**：年收入 100 万美元以下，Apple 抽成从 30% 降到 15%。App Store Connect → 业务里申请。
3. **创建内购项目**：你的 App → 货币化（Monetization）→ App 内购买项目 → ＋：
   - 类型：**非消耗型（Non-Consumable）**
   - 参考名称：`Unlock`　　**产品 ID：`com.pianistassistant.app.unlock`**（必须一字不差，和 `mobile/ios-store/PianistStorePlugin.swift` 里一致；如果想换，两边一起改）
   - 价格：选一档（App Store 会按各国自动换算；App 里显示的是本地货币价格）
   - 本地化显示名称/描述：中文、英文、法文各填一条，例如“解锁完整版 / 一次购买，永久使用全部功能”
   - 审核截图：随便放一张 App 里弹出“解锁完整版”对话框的截图（用 TestFlight 版本的，到期状态可用测试账号模拟，或用任意界面截图，Apple 只是要证明购买入口在哪）
   - 家人共享：建议开启
4. **提交审核时**：在“版本”页面的“App 内购买项目”区域把这个内购勾上，和 App 一起送审（第一个版本必须这样）。
5. **App 描述里写清楚**：“免费试用 14 天，之后一次性购买解锁，不是订阅。”（Apple 要求价格模式说明清楚，写在描述和截图里都可以。）
6. **用沙盒账号测试购买**：App Store Connect → 用户和访问 → 沙盒 → 添加沙盒测试员（用一个没注册过 Apple ID 的邮箱）。TestFlight 里安装后，购买时用这个沙盒账号登录，不会真的扣钱。

### 没法在这里测试的（诚实说明）
- StoreKit 购买、恢复、`AppTransaction` 首次下载日期、沙盒账号：需要真机 + 你的 Apple 账号，这里测不了。网页测试里用“假 App Store”验证了界面流程（试用天数、到期弹窗、取消不报“完成”、购买后解锁、恢复购买）。
- Swift 代码由 GitHub 的 macOS 机器编译（`mobile.yml` 的 ios 任务），编译通过只说明语法对，**不说明运行正确**。第一次 TestFlight 一定要走一遍：试用提示 → 把手机日期改到 15 天后 → 弹窗 → 沙盒购买 → 恢复购买。
- TestFlight / 沙盒里“首次下载日期”可能与正式版不同，试用天数的测试以“把设备日期往后调”为准。
- 如果 App 里找不到原生插件（比如注册失败），会按本机日期数 14 天，到期后买不了——所以 TestFlight 的这个检查不能省。

### 开关
`PAYWALL=0 bash mobile/scripts/build-ios.sh` 构建不带试用/购买的版本（比如给朋友的内测包）。默认带。


## 只有 Windows 电脑，怎么在自己的 iPad 上试？

Xcode 只能装在 Mac 上，所以 Windows 上有两条路：

**A. 免费：自己侧载（只给自己试，7 天后要重装）**
1. 从发布页 [app-builds](https://github.com/user202201/PianistAssistant/releases/tag/app-builds) 下载 `PianistAssistant-unsigned.ipa`（未签名，GitHub 的 Mac 机器自动生成，每次打包都会更新）。
2. 在 Windows 上装 Sideloadly 之类的侧载工具（需要 iTunes / Apple 设备驱动），用数据线连 iPad，用你自己的 Apple ID 给这个 .ipa 签名并安装。
3. iPad：设置 → 通用 → VPN 与设备管理 → 信任你的 Apple ID；如果提示，打开“开发者模式”。
- 免费 Apple ID 的限制：签名 7 天过期、同时最多几个侧载 App。**侧载版测不了内购**（购买需要正式签名和沙盒账号），试用天数会按设备日期计；但 Apple Pencil 标注、自动翻页、离线、指法、播放都能测。
- ⚠️ 侧载工具是第三方软件，不是我们和苹果提供的；用法以它们自己的说明为准。这个未签名 .ipa 我**没有在真机上验证过**（CI 只验证它能生成），第一次装不上请把提示发给我。

**B. 付费（$99/年的 Apple Developer 账号）：TestFlight**
- 完整测试内购、沙盒购买、和上架一致的包。步骤就是上面的“二、把机密交给自动打包”和“三、测试与上架”。
- Windows 上做证书有点绕（证书请求要用 openssl 或在线工具生成），做到那一步卡住了，告诉我，我再写一份 Windows 专用的逐步说明。

## Sprachen / 言語 / 언어 / Langues
Die App spricht Chinesisch, Englisch, Französisch, Deutsch, Japanisch und Koreanisch (Info.plist `CFBundleLocalizations` wird vom Build gesetzt).
**Die App-Store-Seite** (Name, Beschreibung, Screenshots, Stichwörter) wird in App Store Connect pro Sprache angelegt: App-Informationen → Lokalisierungen → Sprache hinzufügen.
The in-app texts were translated by an AI and have not been reviewed by native speakers; before a release, let a native speaker of each language read the main screens.
