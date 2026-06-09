import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a fully static site (out/) — the app is entirely client-side, so there
  // are no server features to give up. Deployable to any static host or Vercel.
  output: "export",
  reactCompiler: true,
};

export default nextConfig;
