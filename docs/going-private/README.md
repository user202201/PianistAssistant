# 以后把代码仓库改成私有：一步一步（不需要任何人帮忙）

> 目标：App 上架（或你决定不再需要网页版）以后，把代码仓库 `PianistAssistant` 改成私有，**同时让 PDF 转换、自动打包都继续工作**。
> 每一步都写到“点哪里、填什么”。**第 1 步现在就可以做，越早做越好**；后面的步骤等你真的要改私有时再做。

## 先弄清楚：改私有会影响什么

| 东西 | 改私有后 | 怎么处理 |
|---|---|---|
| 已经装在手机上的 App | **不受影响**（代码已经在 App 里） | 不用处理 |
| 网页版（GitHub Pages） | **会打不开**（免费账号的私有仓库没有 Pages） | 第 2 步：搬到 Cloudflare Pages（免费，支持私有仓库），或不再用网页版 |
| PDF 转换 | 谱子仓库运行时会去公开仓库取转换脚本，**改私有后取不到** | 第 1 步：把转换脚本放进谱子仓库（一次性，现在就能做） |
| 自动打包 App | 私有仓库每月有 2000 分钟免费额度；Mac（iOS）打包按 10 倍算 | 第 4 步：控制 iOS 打包次数 |
| 下载安装包的链接（Release） | 私有后，别人要登录 GitHub 且有权限才能下载 | 第 4 步 |

## 第 1 步（现在就做）：让 PDF 转换不再依赖公开仓库

1. 打开 https://github.com/user202201/PianistAssistant/releases/tag/app-builds
2. 下载 `scores-repo-bundle.zip`，在电脑上解压，会得到两个文件夹 `.github` 和 `tools`，还有一个说明。
   - 看不到 `.github`？它是隐藏文件夹：Windows 资源管理器 → 查看 → 勾选“隐藏的项目”；Mac 按 `Command + Shift + .`。
3. 打开你的**私有谱子仓库**（`user202201/PianistScores`）的网页 → 点 **Add file → Upload files**。
4. 把 `.github` 和 `tools` 两个文件夹整个拖进去（如果浏览器不允许拖隐藏文件夹，就进到 `.github/workflows` 里把 `convert.yml` 拖进去，再把 `tools` 里的 5 个文件拖进去，路径要保持 `tools/convert.sh`、`tools/convert-one.sh`、`tools/convert-homr.sh`、`tools/convert-oemer.sh`、`tools/merge-pages.py`、`.github/workflows/convert.yml`）。
5. 页面下方点 **Commit changes**（直接提交到 main）。
6. 验证：在 App 里上传一个小 PDF 选“转换”，几分钟后出现在谱子列表里，就说明好了。打开谱子仓库 → Actions → 最近一次 convert，日志里应该能看到 `bash tools/convert.sh`。

做完这一步，转换就和代码仓库没关系了。

> 想更新转换脚本时（比如我改进了识别）：重新下载最新的 `scores-repo-bundle.zip`，重复上面的第 3–5 步即可，会提示“替换同名文件”，选替换。

## 第 2 步（改私有前）：网页版搬到 Cloudflare Pages（不需要网页版可以跳过）

1. 打开 https://dash.cloudflare.com/sign-up 注册免费账号并验证邮箱。
2. 左侧菜单 **Workers & Pages → Create → Pages → Connect to Git**。
3. 点 **Connect GitHub**，授权，选择仓库 `PianistAssistant`（选择“Only select repositories”只给这一个仓库的权限）。
4. 设置构建：
   - Framework preset：**None**
   - Build command：`npm run build`
   - Build output directory：`dist`
   - **Environment variables**（Production）：`BASE_PATH` = `/`，`NODE_VERSION` = `22`
5. 点 **Save and Deploy**，等几分钟，得到一个网址，形如 `https://pianistassistant.pages.dev`。
6. **在旧设备上先生成登录二维码**（设置 → 登录与设备 → 手机扫码登录），再到 iPad 上打开新网址，扫码登录；然后在 Safari 里“添加到主屏幕”，把旧图标删掉（新旧网址的数据互不相通，所以要重新登录）。
7. 以后每次我（或你）往代码仓库推送，Cloudflare 会自动重新部署。

## 第 3 步：把代码仓库改成私有

1. 打开 https://github.com/user202201/PianistAssistant → **Settings**（右上，齿轮）。
2. 往下拉到最底部 **Danger Zone** → **Change repository visibility** → **Change to private**。
3. 按提示输入仓库名确认。
4. 然后关掉不再需要的网页部署：仓库 → **Actions** → 左侧点 **deploy** → 右上角 **…** → **Disable workflow**（不关的话每次推送都会发一封“部署失败”的邮件）。

## 第 4 步：改私有之后检查

1. 仓库 → Actions → **mobile-packages**，点 **Run workflow** 手动跑一次，确认 Android / iOS 打包还成功。
2. **控制费用**：私有仓库每月免费 2000 分钟，Mac 机器按 10 倍算（iOS 打一次约 40 分钟额度）。App 代码每次推送都会触发打包，建议：
   - 日常改代码时少推送；
   - 或者把 `.github/workflows/mobile.yml` 顶部 `on:` 里的 `push:` 整段删掉，只保留 `workflow_dispatch:`，以后需要打包时手动点 Run workflow。
3. **下载安装包**：私有仓库的 Release 只有你自己登录 GitHub 才能下载（手机上也要登录 GitHub 网页）。给朋友测试 Android 的话，要么把 apk 直接发给他，要么临时把仓库改回公开。
4. PDF 转换：再上传一个 PDF 试一次（见第 1 步第 6 点）。

## 如果哪一步卡住了

- 把你看到的**屏幕截图**和 **Actions 的错误日志**（点进红色的那次运行，复制报错那几行）保存下来。
- 常见的问题和原因：
  - 转换一直“正在转换”：谱子仓库 → Actions 里 convert 是红色的，点进去看日志；多半是第 1 步的文件路径放错了。
  - Cloudflare 构建失败：看 Build log，确认环境变量 `BASE_PATH=/` 和 `NODE_VERSION=22` 都填了。
  - 打包失败：Actions → mobile-packages → 点红色的那个任务。
