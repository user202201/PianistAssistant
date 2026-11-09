// HarmonyOS (ArkTS) page that shows the web app. NOT VERIFIED on a real device yet — see README.md.
import { webview } from '@kit.ArkWeb';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();

  build() {
    Column() {
      Web({ src: $rawfile('index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.None)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
