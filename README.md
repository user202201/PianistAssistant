# 🎹 Pianist Assistant

钢琴练习助手：上传 MusicXML 琴谱，全屏显示并播放，播放时光标跟随，可调速、分左右手、分声部（四手联弹）、循环练习。

- 网页：GitHub Pages，推送到 `main` 后自动部署，**不需要手动启动**，可“安装”到手机/电脑桌面（PWA）。
- 琴谱：存放在**另一个私有仓库**（例如 `PianistScores` 的 `scores/` 目录），本仓库只有代码。
- 登录：用只授权该私有仓库的 GitHub 令牌。没有令牌看不到任何琴谱。

## 一次性设置（约 5 分钟）

1. **建私有仓库**：GitHub 新建 `PianistScores`，选 **Private**（里面放什么都可以，应用会自动创建 `scores/` 目录）。
2. **开启网页部署**：本仓库 Settings → Pages → Source 选 **GitHub Actions**；把开发分支合并到 `main`，等 Actions 里的 `deploy` 跑完。网址：`https://user202201.github.io/PianistAssistant/`
3. **生成令牌**：https://github.com/settings/personal-access-tokens/new
   - Repository access：**Only select repositories** → 只选 `PianistScores`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Expiration：最长 1 年，到期后重新生成一个即可
4. 打开网址，粘贴令牌登录。每台设备登录一次，之后自动记住（只保存在该设备浏览器里）。

## 多设备登录

- **扫码登录**：在已登录的设备上，设置 ⚙ → 登录与设备 → 手机扫码登录，用另一台设备的相机扫描即可，二维码 60 秒后自动关闭。也可以“复制登录链接”粘贴到新设备的登录页。
- **保持登录**：登录页默认勾选。不勾选则关闭页面后需重新登录，适合公用设备。
- **iPad / iPhone**：请先用 Safari“添加到主屏幕”，再从主屏幕图标打开并登录。Safari 对长期不用的网页会清除记住的登录，装到主屏幕的应用不会。主屏幕应用的存储和 Safari 是分开的，所以要在主屏幕应用里登录（用“复制登录链接”粘贴最方便）。
- 所有设备共用同一个令牌，**无法单独移除某台设备**。设备丢失时到 GitHub 令牌管理删除令牌，所有设备立即失效，再生成新令牌即可。

## 安全说明

| 问题 | 情况 |
|---|---|
| 别人改我的代码 | 只有你的 GitHub 账号能推送本仓库；建议开启两步验证，并给 `main` 开分支保护。 |
| 别人看我的琴谱 | 琴谱在私有仓库，读取必须带令牌。登录时若检测到仓库是公开的会拒绝登录。 |
| 令牌泄露 | 令牌只能访问那一个私有仓库，且可在 GitHub 随时撤销。不要把令牌发给别人或写进代码。 |
| 网页代码是公开的 | 是，但里面没有任何秘密，也不含琴谱。 |

## 支持的琴谱格式

`.musicxml` / `.xml` / `.mxl`（MuseScore、Finale、Sibelius、Dorico 都能导出；MuseScore 官网也有大量免费 MusicXML）。
暂不支持 PDF / 图片（需要乐谱识别），MIDI 以后可加。

## 功能

- 播放 / 暂停 / 回到开头，空格键暂停，←→ 切换小节；速度 20%–150%
- 左右手选择（双手 / 右手 / 左手）
- 声部选择：多个声部（如四手联弹 Primo / Secondo）可单独开关声音，用来和自己合奏
- 练习：开始前倒数、节拍器、循环指定小节、每遍循环自动加速
- 钢琴音色可切换（设置 ⚙）：Splendid / FluidR3 / MusyngKite / 明亮钢琴 / 电钢琴；音色下载失败时自动用内置合成音色
- 重复记号、连音线、速度变化均会按乐谱处理；光标自动跟随并滚动

`samples/` 里有两份测试谱可以用来试用。

## 本地开发

```bash
npm install
BASE_PATH=/ npm run dev     # http://localhost:5173
npm run build
```

## 已知限制 / 后续可做

- 学习模式的“等待模式”（你弹对才往下走，需 MIDI 键盘）、点击乐谱跳转、MIDI 文件导入、力度/踏板还没做。
- 节拍器按首个小节的拍号与速度固定节奏。
- 钢琴采样从公开 CDN 下载，首次加载后由浏览器缓存。
