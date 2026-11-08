import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/PianistAssistant/
  base: process.env.BASE_PATH ?? "/PianistAssistant/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pianist Assistant",
        short_name: "Pianist",
        description: "Sheet music player for piano practice",
        theme_color: "#1f2937",
        background_color: "#111827",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
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
