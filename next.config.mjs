import { securityHeaders } from "./lib/security/csp.mjs";

const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["lighter-ts", "zklighter-perps"],
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
  turbopack: {
    resolveAlias: {
      "@react-native-async-storage/async-storage": "./lib/empty-module.ts",
    },
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  // FE-02: CSP + anti-framing on every route. The RPC origin is fixed at build time.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          rpcUrl: process.env.NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL,
          dev: isDev,
        }),
      },
    ];
  },
};

export default nextConfig;
