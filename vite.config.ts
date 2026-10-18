import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, readFileSync, statSync } from "fs";

// Versión de la app (leída de package.json) para mostrarla dentro del programa.
const appVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
).version as string;

// Tauri sirve el frontend desde este servidor de Vite en desarrollo.
// El puerto es fijo (1420) porque tauri.conf.json apunta a él.
const host = process.env.TAURI_DEV_HOST;

/**
 * Modo navegador de PRUEBA (solo `vite dev`, nunca en el programa empaquetado):
 * si existe la variable DJ_BIBLIOTECA_JSON (un JSON con la forma de
 * `read_library`), el frontend abierto en un navegador normal puede leer la
 * biblioteca y el audio por HTTP. Sirve para probar el automix de punta a
 * punta sin la ventana nativa. Ver `src/lib/tauri.ts` (modo navegador).
 */
function pruebaEnNavegador(): Plugin {
  const json = process.env.DJ_BIBLIOTECA_JSON;
  return {
    name: "infiniity-prueba-navegador",
    apply: "serve",
    configureServer(server) {
      if (!json) return;
      const raiz = (JSON.parse(readFileSync(json, "utf-8")) as { root: string }).root;
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname === "/__dj/biblioteca.json") {
          res.setHeader("Content-Type", "application/json");
          createReadStream(json).pipe(res);
          return;
        }
        if (url.pathname === "/__dj/media") {
          const ruta = url.searchParams.get("path") ?? "";
          // Solo archivos de audio dentro de la biblioteca indicada.
          if (!ruta.startsWith(raiz) || ruta.includes("..") || !/\.(mp3|wav)$/i.test(ruta) || !existsSync(ruta)) {
            res.statusCode = 404;
            res.end("no");
            return;
          }
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", String(statSync(ruta).size));
          createReadStream(ruta).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pruebaEnNavegador()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
