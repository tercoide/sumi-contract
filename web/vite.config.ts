import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The screens: client/ is built into dist/client, which the server serves. With npm run dev, Vite serves them
// on :5173 and passes /api to the server on :8064.
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8064", "/auth": "http://127.0.0.1:8064" } },
});
