import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: fileURLToPath(new URL("../app/static", import.meta.url)), emptyOutDir: true },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: { "/api": "http://127.0.0.1:8000", "/logo.png": "http://127.0.0.1:8000" },
  },
});
