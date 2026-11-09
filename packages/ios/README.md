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
3. **审核提示（已处理）**：苹果审核员没有 GitHub 令牌，所以 App 打开后第一个按钮是“**在本机使用（不需要账号）**”，不用登录就能上传谱子、播放、收藏、备份。GitHub 同步放在“高级”里，是可选功能。这符合苹果“不要强制登录”的规定。

## 没有 Mac 也行吗

可以。上面的打包、签名、上传全部在 GitHub 的 Mac 机器上自动完成，你不需要自己有 Mac。

## 已知限制

- 钢琴音色第一次用要联网下载，之后由系统缓存。
- 谱子目前存在 GitHub 私有仓库，App 里会保留离线副本。

## 上架前自查清单（苹果审核常见问题）

| 项目 | 状态 |
|---|---|
| 不强制登录 | ✅ 默认“在本机使用”，不需要任何账号 |
| 不是“只套了个网页” | ✅ 代码和默认钢琴音色都打包在 App 里，可完全离线使用，有本地文件存储、备份 |
| 加密出口合规 | ✅ 已自动设置 `ITSAppUsesNonExemptEncryption = false`（只用系统自带的 HTTPS） |
| 隐私政策网址 | ❌ 需要你提供一个网页地址。App 不收集任何数据；GitHub 同步是用户自己的账号。可以用 GitHub Pages 放一页文字 |
| 隐私问卷（App Privacy） | 选“不收集数据”（App 没有统计、广告、第三方 SDK） |
| 截图 | ❌ 需要 iPhone 和 iPad 的截图（我可以在模拟器里帮你截） |
| 年龄分级、类别 | 类别选“音乐”；无不适内容 |
| 评审备注 | 写明：“可点‘在本机使用’直接体验；需要乐谱文件可从 samples 下载” |

> 风险提示：苹果有条规定（4.2）不喜欢“只是网站换壳”的 App。我们有离线、本地存储、文件导入导出，通常没问题，但最终由审核员判断，可能被要求补充说明。

## 免费装到自己的设备（不上架）

有 Mac + Xcode 的话，用免费的 Apple ID 就能装到自己的 iPhone/iPad：解压 `PianistAssistant-ios-xcode-project.zip` → 用 Xcode 打开 `ios/App/App.xcworkspace` → 选你的设备 → 在 Signing 里选你的 Apple ID（Personal Team）→ 点运行。免费签名**每 7 天过期一次**，要重新装一遍；也不能用 TestFlight。没有 Mac 就做不到（这是苹果的限制），可以继续用网页添加到主屏幕。
