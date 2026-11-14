import path from "node:path";
import type { NextConfig } from "next";

// Next only reads .env from apps/web; the monorepo keeps one .env at the root.
// Vercel has no .env file and sets the variables itself, so a missing file is fine.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {}

const config: NextConfig = {
  transpilePackages: ["@epicaid/core", "@epicaid/db"],
};

export default config;
