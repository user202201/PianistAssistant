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
3. ⚠️ **审核提示**：苹果审核员需要能登录使用 App。现在登录要 GitHub 令牌，审核员没有。所以**上架前要先做“仅本机存储”模式**（不需要登录，谱子存在手机里），否则很可能被拒。这个我会在上架前做好。

## 没有 Mac 也行吗

可以。上面的打包、签名、上传全部在 GitHub 的 Mac 机器上自动完成，你不需要自己有 Mac。

## 已知限制

- 钢琴音色第一次用要联网下载，之后由系统缓存。
- 谱子目前存在 GitHub 私有仓库，App 里会保留离线副本。
