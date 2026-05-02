import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Province polygon saves + safety margin. Reference chart uploads use
      // signed Storage URLs from the server so the file never transits the
      // Server Action body (see map-editor actions).
      bodySizeLimit: "110mb",
    },
  },
};

export default nextConfig;
