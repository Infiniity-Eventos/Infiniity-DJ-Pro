import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri sirve el frontend desde este servidor de Vite en desarrollo.
// El puerto es fijo (1420) porque tauri.conf.json apunta a él.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Evita que Vite oculte errores útiles de Rust/Tauri en consola.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // No vigilar la carpeta de Rust: ahorra CPU en equipos de gama baja.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Salida moderna: los webviews de Tauri son recientes, así el bundle pesa menos.
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
