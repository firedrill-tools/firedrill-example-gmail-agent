import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4311,
    strictPort: true,
    cors: false,
    fs: {
      strict: true,
      allow: [webRoot, fileURLToPath(new URL("../node_modules", import.meta.url))],
      deny: [".env", ".env.*", "**/.git/**", "**/*.sqlite*", "*.{pem,key,p12,pfx}"],
    },
    proxy: {
      "/api": "http://127.0.0.1:4310",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
