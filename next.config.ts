import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Load these with Node's require instead of bundling: sharp ships native
  // binaries and exifr lazily imports Node built-ins.
  serverExternalPackages: ["sharp", "exifr"],
};

export default nextConfig;
