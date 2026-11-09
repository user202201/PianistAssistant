# Android 安装与上架（按小白步骤）

## 你会得到什么

每次打包后，在 Release 页面（https://github.com/user202201/PianistAssistant/releases/tag/app-builds）有：

- `PianistAssistant-debug.apk` —— **可以直接装在安卓手机上**的安装包（测试签名，自己用、给朋友试用都行，**不能上架 Google Play**）。
- 配置了签名密钥之后，还会多出 `PianistAssistant-release.aab`（上架 Google Play 用）和 `PianistAssistant-release.apk`。

## 一、先装到自己的手机试试（5 分钟，免费）

1. 在安卓手机的浏览器里打开上面的 Release 地址，点 `PianistAssistant-debug.apk` 下载。
2. 下载完成后点开它。手机会提示“不允许安装未知来源应用”→ 点**设置**，给你用的浏览器打开“允许安装应用”，再返回继续安装。（安卓允许安装网页下载的 App，这是正常的，只是系统多问一句。）
3. 如果弹出 “Google Play 保护机制” 的提示，点**仍然安装**（因为这是你自己打包的测试版）。
4. 打开 App，用 GitHub 令牌登录，和网页一样使用。

## 二、上架 Google Play 商店

需要的东西：一个 Google 账号、一张能付 25 美元的银行卡（一次性注册费）、一个能公开访问的隐私政策网页（可以是 GitHub Pages 上的一页）。

1. **注册开发者账号**：打开 https://play.google.com/console ，按提示注册并付 25 美元，通过身份验证（需要几天）。
2. **生成上架用的签名密钥**（在电脑上，装好 Java 后运行，把 `密码` 换成你自己的；**这个文件和密码要永久备份，丢了就无法更新 App**）：
   ```bash
   keytool -genkeypair -v -keystore release.keystore -alias pianist -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.keystore > keystore.b64
   ```
3. **把密钥交给自动打包**：GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，添加 4 项：
   - `ANDROID_KEYSTORE_B64`：`keystore.b64` 文件里的全部内容
   - `ANDROID_KEYSTORE_PASSWORD`：上一步设的密码
   - `ANDROID_KEY_ALIAS`：`pianist`
   - `ANDROID_KEY_PASSWORD`：密钥密码（上一步没单独设就和上面一样）
4. 到 Actions → mobile-packages → Run workflow，重新打包一次。完成后 Release 页面会有 `PianistAssistant-release.aab`。
5. 在 Play Console 点**创建应用**，填名称、语言、免费/付费；在“应用内容”里填隐私政策地址、内容分级问卷、目标受众。
6. 在“测试 → 内部测试”里上传 `.aab`，先自己测试；没问题再到“正式版”提交审核。
7. 审核一般几天。通过后就能在 Google Play 搜到。

> 注意：个人开发者账号（2023 年底以后注册的）目前要求先找 12 名测试者连续测试 14 天，才能申请正式上架。这条政策可能有变化，请以 Play Console 里的提示为准。

## 三、不想上 Google Play，也可以

- 直接把 apk 发给别人（见第一部分）。
- 国内安卓商店（华为应用市场、小米、OPPO、vivo 等）一般都接受 apk/aab，各家要先注册开发者账号，有的还要软件著作权，这部分本文不展开。

## 每次更新

代码一变，Release 里的 apk 自动更新；上架后的新版本要再上传一个新的 `.aab`（版本号每次打包自动加一，不用手改）。

## 已知限制

- 钢琴音色第一次用要联网下载，之后由系统缓存；没联网时会改用内置合成音色。
- 谱子和网页一样存在 GitHub 私有仓库，App 会在手机上保留离线副本。
