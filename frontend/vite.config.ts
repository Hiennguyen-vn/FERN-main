import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

interface ProxyRequestLike {
  getHeader(name: string): unknown;
  removeHeader(name: string): void;
}

interface ProxyWithEvents {
  on(event: "proxyReq", listener: (proxyReq: ProxyRequestLike) => void): void;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8080";
  const devPort = Number(env.VITE_DEV_PORT || 8095);
  const stripOriginOnProxyReq = (proxy: ProxyWithEvents) => {
    proxy.on("proxyReq", (proxyReq: ProxyRequestLike) => {
      if (proxyReq.getHeader("origin")) {
        proxyReq.removeHeader("origin");
      }
    });
  };

  return {
    server: {
      host: "::",
      port: devPort,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          proxyTimeout: 180_000,
          configure: stripOriginOnProxyReq,
        },
        "/health": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          configure: stripOriginOnProxyReq,
        },
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
