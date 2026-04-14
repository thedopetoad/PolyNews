import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
      },
      // Relay CDN — chain/token icons in deposit/withdraw modals
      { protocol: "https", hostname: "assets.relay.link" },
      // CoinGecko — token logos
      { protocol: "https", hostname: "coin-images.coingecko.com" },
    ],
  },
};

export default nextConfig;
