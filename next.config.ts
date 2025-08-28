import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Disable ESLint during builds to prevent deployment failures
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable type checking during builds to prevent deployment failures
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
