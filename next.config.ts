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
  async redirects() {
    return [
      // Legacy paper-trade route — all paper trading now lives inside
      // the Airdrop page. 308 keeps the method (though this route was
      // only ever GET-served to visitors).
      { source: "/trade", destination: "/airdrop?tab=trade", permanent: true },
    ];
  },
};

export default nextConfig;
