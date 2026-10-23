import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // puppeteer-core must stay a runtime require on the server, never bundled.
  serverExternalPackages: ["puppeteer-core"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
