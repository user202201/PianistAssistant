# 安全检查记录与已知风险

最后一次完整检查：2026-11-14。方法：扫描源码与 git 历史找密钥；`npm audit`；人工查所有 `innerHTML` / `window.open` / `fetch` / 令牌存放；查全部工作流的权限与注入点；下载发布页里的 5 个成品（安卓 APK、苹果工程 zip、未签名 ipa、鸿蒙包、乐谱仓库包）解压后扫描；用浏览器测试构建出来的网页版和商店版。

## 检查结果（没发现问题的）
- **密钥**：源码、git 历史、5 个成品里没有 GitHub 令牌、私钥、证书、keystore、`.env`（只有测试里的假令牌 `ghp_abcdefgh…`）。提交作者都是 `noreply@anthropic.com`，没有个人邮箱。`.gitignore` 排除了 keystore、`mobile/ios`、`mobile/android`、构建输出。
- **依赖**：`npm audit --omit=dev`（主项目和 `mobile/`）0 个漏洞；只有 `fsevents` 一个安装脚本（macOS 官方依赖）。pdf.js 在 4.10 以上（早期的字体执行漏洞已修复）。
- **注入**：整个 `src/` 里只有 3 处 `innerHTML`（两处是写死的图标，一处是预览，只放自己生成的数字和元素 id），没有 `eval`、`document.write`、`postMessage`；谱名、标题都用 `textContent`。外部链接都有 `rel="noopener"`；`window.open` 带 `noopener`。
- **网络**：运行时只访问 `api.github.com`（用户自己的仓库）和两个钢琴音色服务器 `smpldsnds.github.io`、`gleitz.github.io`；没有统计、广告、第三方脚本。
- **令牌**：默认存在 `localStorage`，不勾"保持登录"时只在 `sessionStorage`；二维码登录链接把令牌放在 `#` 后面（不会发给任何服务器），读到后立刻从地址栏和历史里清掉。错误日志在本机，已去掉令牌、带密钥的网址和文件名。
- **工作流**：没有 `pull_request_target`、没有 `pull_request` 触发（外人的 PR 无法跑你的流程）；都是 `push` 到指定分支或手动；每个工作流都声明了最小权限；用户输入（`inputs.*`）只通过 `env` 传入，没有拼进命令；苹果 / 安卓机密只在打包步骤里用。
- **成品**：苹果 `Info.plist` 只有麦克风、蓝牙用途说明，没有关闭 ATS（没有允许明文 HTTP）；`ITSAppUsesNonExemptEncryption=false`；ipa 未签名且不含描述文件；原生插件（Swift）里没有任何网络调用；鸿蒙包没有外部网址。

## 这次发现并修掉的
1. **商店版没有真正禁用 GitHub 登录**：以前商店版靠"界面里不出现按钮"，但 `#/link/…` 登录链接和 `api.login()` 仍然可用。现在 `LOCAL_ONLY` 构建里 `login()`、`connectConversion()`、所有 GitHub 请求入口都直接拒绝，登录链接只会清掉地址栏并回到主页。
2. **`.mxl` 解压炸弹**：一个几十 KB 的 zip 可以解压成几 GB，占满设备内存。现在只解压 `container.xml` 和 `.xml/.musicxml`，每个条目最大 50 MB（fflate 按声明大小截断，头部撒谎也没用）。
3. **网页版没有内容安全策略（CSP）**：加了（`vite.config.ts` 的 `securityMeta`，只在生产构建里）：禁止内联脚本和外部脚本；`connect-src` 只允许上面三个服务器，所以即使有脚本混进来，也无法把令牌发到别处；`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`；`referrer: no-referrer`。
4. pdf.js 加了 `isEvalSupported: false`（纵深防御）。

对应测试：`tests/e2e/76-zip-bomb.cjs`；`tests/shell/build-security.sh`（构建出网页版和商店版后用浏览器检查：策略存在、没有内联脚本、正常使用——本机库、上传、打开并播放、PDF 查看——不触发策略、注入脚本不执行、向清单外服务器的请求被拦、商店版登录链接不产生任何 GitHub 请求）。这些测试在旧代码上都会失败（已验证），并已接入 `tests/run-all.sh`。

## 仍然存在的风险（要知道，不一定要现在处理）
| 风险 | 说明 | 建议 |
|---|---|---|
| 令牌在 `localStorage`（网页版）| 任何能在页面里执行脚本的漏洞都能读到。现在有 CSP 和没有注入点两层防护 | 令牌只给**一个仓库**的 Contents 权限（登录页已这样提示）；用完可随时在 GitHub 令牌管理里撤销 |
| App 安装包没有 CSP | 手机 App 的 WebView 我在这里无法试，加了可能让原生桥失效；商店版本地模式没有令牌，影响面小 | 有真机后再加并测试 |
| 转换流程的第三方软件没有锁版本 | 用户私有仓库的 `convert.yml` 运行时 `pip install homr` / 下载 Audiveris，这些进程在拥有仓库写权限的 `GITHUB_TOKEN` 下运行。若上游被投毒，可改动你的乐谱仓库（令牌只对这一个仓库有效，作业结束即失效）| 把 homr / Audiveris 固定到测过的版本并校验哈希（`AUDIVERIS_VERSION` 已支持固定版本，homr 还没有）|
| GitHub Actions 只按标签（`@v4`）引用 | 都是官方 `actions/*`，没有用 SHA 固定 | 低风险；以后可固定 |
| 发布页有 `PianistAssistant-debug.apk` | 调试签名、可调试的安装包，任何人可下载；每次构建的调试证书不同，也无法覆盖升级 | 给别人用时发正式签名的 release 包（需要你的 keystore）|
| 安卓 `allowBackup` 为默认值、有 `INTERNET` 权限 | 系统备份可能把 App 内的乐谱带进你自己的 Google 备份；商店版其实不联网 | 想严格对应"数据不离开设备"可以关闭备份；有同步功能的版本需要联网权限 |
| 试用 / 买断只在客户端判断 | 重装可重置试用，越狱设备可绕过 | 属于商业而非用户数据风险；正式收费前再决定要不要服务器校验收据 |
| 商店版代码里仍有未使用的 GitHub 相关函数 | 只是没被删掉的死代码，运行时被禁用（有测试）| 不影响安全；以后可以让构建工具彻底删除 |
| git 历史里还有一份有版权的 PDF | 这是版权问题，不是安全问题；要彻底清除需要强制推送改写历史 | 等你决定 |

## 没法在这里测的
真机上的原生插件（蓝牙 / MIDI / 购买）、App 的 WebView 里 CSP 的表现、真实苹果 / 谷歌签名流程、真实的 GitHub 令牌权限范围。
