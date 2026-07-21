import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "3001",
        pathname: "/icons/**",
      },
      {
        protocol: "http",
        hostname: "backend",
        port: "3001",
        pathname: "/icons/**",
      },
      {
        protocol: "https",
        hostname: "**",
        pathname: "/icons/**",
      },
      {
        protocol: "https",
        hostname: "render.worldofwarcraft.com",
        pathname: "/**",
      },
    ],
    // Disable image optimization for development to avoid issues with localhost images
    unoptimized: true, //process.env.NODE_ENV === "development",
  },
};

export default withNextIntl(nextConfig);
