import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// MOBILE=1: build for the iOS / Android / HarmonyOS apps (mobile/): files are loaded from inside the app, relative paths,
// no service worker (the app itself is the offline copy). Everything else is the same code as the website.
const mobile = !!process.env.MOBILE;

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16).replace("T", " ")),
    __MOBILE__: JSON.stringify(mobile),
  },
  // website: GitHub Pages project site https://<user>.github.io/PianistAssistant/ ; app: relative paths
  base: mobile ? "./" : process.env.BASE_PATH ?? "/PianistAssistant/",
  build: mobile ? { outDir: "dist-app" } : {},
  resolve: mobile ? { alias: { "virtual:pwa-register": new URL("./src/pwa-stub.ts", import.meta.url).pathname } } : {},
  plugins: mobile ? [] : [
    VitePWA({
      registerType: "prompt", // the app decides when it is safe to reload (not while playing / editing)
      manifest: {
        name: "Pianist Assistant",
        short_name: "Pianist",
        description: "Sheet music player for piano practice",
        theme_color: "#f2f2f7",
        background_color: "#f2f2f7",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // piano samples are large: cache after first download
            urlPattern: ({ url }) => /github\.io|gleitz|jsdelivr/.test(url.hostname),
            handler: "CacheFirst",
            options: { cacheName: "samples", expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
});
