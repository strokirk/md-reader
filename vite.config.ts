import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: { target: "es2022", sourcemap: false },
  worker: { format: "es" },
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*.png"],
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"] },
      manifest: {
        name: "MD Reader",
        short_name: "Reader",
        description: "Read and search a personal library of Markdown books, offline.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#14161a",
        theme_color: "#14161a",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        share_target: {
          action: "share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            files: [
              {
                name: "files",
                accept: ["text/markdown", "text/plain", ".md", ".markdown", ".txt"],
              },
            ],
          },
        },
        file_handlers: [
          {
            action: "./",
            accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
