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
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8180";
  const devPort = Number(env.VITE_DEV_PORT || 8082);
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
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }
            if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
            if (id.includes("/recharts/")) return "vendor-charts";
            if (id.includes("/@radix-ui/")) return "vendor-radix";
            if (id.includes("/@tanstack/")) return "vendor-query";
            if (id.includes("/react-router-dom/") || id.includes("/@remix-run/")) return "vendor-router";
            if (id.includes("/react-hook-form/") || id.includes("/@hookform/")) return "vendor-forms";
            if (id.includes("/react-day-picker/") || id.includes("/date-fns/")) return "vendor-calendar";
            if (id.includes("/next-themes/") || id.includes("/sonner/")) return "vendor-shell";
            if (id.includes("/@supabase/")) return "vendor-supabase";
            if (id.includes("/cmdk/") || id.includes("/vaul/") || id.includes("/embla-carousel-react/")) return "vendor-interactions";
            if (id.includes("/class-variance-authority/") || id.includes("/clsx/") || id.includes("/tailwind-merge/")) return "vendor-ui";
            if (id.includes("/lucide-react/")) return "vendor-icons";
            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
