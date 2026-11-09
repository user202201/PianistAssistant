# Pianist Assistant 的手机 App 安装包

这里讲怎么把 Pianist Assistant 装到手机上、怎么上架商店。**网页版和 App 用的是同一份代码，只是打包方式不同**，所以每次更新网页，三个平台的安装包都会自动重新打包，不用你改任何东西。

| 平台 | 状态 | 说明 |
|---|---|---|
| Android | ✅ 自动打包，可直接安装 | [android/README.md](android/README.md) |
| iOS | ⚠️ 自动打包工程；要装到 iPhone/iPad 或上架，必须有 Apple 开发者账号 | [ios/README.md](ios/README.md) |
| 鸿蒙 HarmonyOS | 🚧 只提供网页包和页面代码，还没在真机验证 | [harmonyos/README.md](harmonyos/README.md) |

## 安装包在哪里

安装包不放在代码仓库里（每次几十 MB，几个月就会把仓库撑爆），而是自动发布在 GitHub 的 **Release** 页面，永远是最新一次打包：

**https://github.com/user202201/PianistAssistant/releases/tag/app-builds**

在手机浏览器里直接打开这个地址就能下载。每次打包的完整记录在仓库的 **Actions → mobile-packages**。

## 怎么自动化的

- `.github/workflows/mobile.yml`：每次 App 代码变化就运行，分别在 Linux（Android）和 Mac（iOS）机器上打包，再把结果放进 Release。
- `mobile/`：打包配置（Capacitor）和脚本。手机工程每次现生成，不需要手工维护。
- 签名密钥、证书这类机密只放在 GitHub 仓库的 **Settings → Secrets and variables → Actions**，不会进代码。

## 常见问题

**Q：以后我把这个仓库改成私有，会有什么影响？**
- 已经装在手机上的 App：**完全不受影响**。代码已经打在 App 里，不需要访问仓库。
- 网页版（GitHub Pages）：**免费账号的私有仓库不能用 GitHub Pages，网页会打不开**。想继续用网页，要么升级 GitHub 付费计划，要么把网页放到别的免费托管（比如 Cloudflare Pages，支持私有仓库）。
- 谱子转换（PDF→乐谱）：转换用的是你的私有谱子仓库，它在运行时会去公开仓库拿转换脚本。仓库改私有后这一步会取不到，需要把脚本复制进谱子仓库，或者加一个访问令牌。改私有前告诉我，我来处理。
- 自动打包：私有仓库每月有免费运行额度（Mac 机器消耗得更快），一般够用。
- 建议：**等 App 在商店上架、并且你不再需要网页版以后再改私有**。

**Q：以后更新 App 要重新上架吗？**
要。App 里的代码是装的那一刻的版本；每次想让用户用到新版本，都要重新打包并在商店提交新版本（Android 和 iOS 都一样）。这是 App 和网页最大的区别：网页刷新就是新版。

**Q：谱子存在哪里？**
目前 App 和网页一样，存在你私有的 GitHub 谱子仓库里（登录用令牌），App 里也会在手机上保留一份离线副本。后续计划增加“只存在本机”的模式（不需要 GitHub 账号），这样普通用户也能直接用，也更容易通过商店审核。
