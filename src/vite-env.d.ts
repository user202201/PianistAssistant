/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD__: string;
/** true in the iOS / Android / HarmonyOS app builds */
declare const __MOBILE__: boolean;
/** true when the GitHub sync is left out of the build (store builds that should work without any account) */
declare const __LOCAL_ONLY__: boolean;
