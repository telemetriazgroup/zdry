import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/zdry/",
  plugins: [react()],
  server: {
    host: true,
    port: 28080,
    proxy: {
      "/zdry/api": {
        target: "http://localhost:3003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/zdry\/api/, ""),
      },
    },
  },
});
