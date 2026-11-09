# 鸿蒙 HarmonyOS（还没验证）

## 现状（说实话）

鸿蒙 NEXT 不能直接运行安卓或苹果的安装包，需要用华为的开发工具 **DevEco Studio** 做一个鸿蒙工程。我这边**没有鸿蒙设备或 DevEco 环境，没法测试**，所以现在只提供了：

- `PianistAssistant-harmonyos-web-bundle.zip`（Release 页面里）：App 的网页文件，已经按“放进 App 里本地打开”的方式打包好。
- `Index.ets`：一个最小的鸿蒙页面，用 ArkWeb 的 `Web` 组件显示这些网页文件。

这两样每次更新自动生成。**优先级低于 iOS 和 Android**，等前两个稳定后再和你一起在真机上验证。

## 如果你想自己试（需要一台华为鸿蒙 NEXT 手机，或 DevEco 的模拟器）

1. 安装 DevEco Studio（https://developer.huawei.com/consumer/cn/deveco-studio/），注册华为开发者账号（个人免费，上架 AppGallery 需要实名认证）。
2. 新建工程：Create Project → **Empty Ability**。
3. 把 `Index.ets` 的内容覆盖到工程里的 `entry/src/main/ets/pages/Index.ets`。
4. 把 `web-bundle.zip` 解压后的**全部文件**放进 `entry/src/main/resources/rawfile/`。
5. 在 `entry/src/main/module.json5` 的 `requestPermissions` 里加上联网权限 `ohos.permission.INTERNET`。
6. 连接手机或模拟器，点运行。

## 已知风险

- 网页用了 JavaScript 模块（`type="module"`），在 `resource://rawfile/` 下加载可能被浏览器内核的跨域规则拦住；如果打开是白屏，需要改成通过 `onInterceptRequest` 提供文件，我会在验证时处理。
- 上架华为应用市场（AppGallery）需要单独的审核和资质，可能要软件著作权。
