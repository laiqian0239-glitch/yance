import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import baseConfig from "@element-hq/element-web-module-api/vite.base.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseConfig, {
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      name: "yance-element-module",
      fileName: "index",
      formats: ["es"]
    }
  },
  plugins: [react()]
});
