import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@leadforge/shared"],
  // Keep the dev badge clear of the sidebar user menu.
  devIndicators: { position: "bottom-right" },
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
