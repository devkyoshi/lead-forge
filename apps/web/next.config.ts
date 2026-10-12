import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@leadforge/shared"],
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
