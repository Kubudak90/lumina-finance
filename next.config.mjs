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
};

export default nextConfig;
