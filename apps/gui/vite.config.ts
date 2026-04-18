import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://localhost:8787";

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: WORKER_ORIGIN, changeOrigin: true },
      "/metrics": { target: WORKER_ORIGIN, changeOrigin: true },
      "/healthz": { target: WORKER_ORIGIN, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
