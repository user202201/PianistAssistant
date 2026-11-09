import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  define: { __BUILD__: JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16).replace("T", " ")) },
  // GitHub Pages project site: https://<user>.github.io/PianistAssistant/
  base: process.env.BASE_PATH ?? "/PianistAssistant/",
  plugins: [
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
