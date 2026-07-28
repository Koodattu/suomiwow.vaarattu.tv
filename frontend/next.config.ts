import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/fun/ccg/:path*",
        destination: "/ccg/:path*",
        permanent: true,
      },
    ];
  },
  output: "standalone",
  // Include Sharp's platform binaries in the minimal production image.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@img/**/*"],
  },
  images: {
    localPatterns: [
      {
        pathname: "/**",
        search: "",
      },
      {
        pathname: "/api/ccg/render",
      },
    ],
    qualities: [75, 95],
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
    // Local development uses backend hostnames that the image optimizer cannot resolve reliably.
    unoptimized: process.env.NODE_ENV === "development",
  },
};

export default withNextIntl(nextConfig);
