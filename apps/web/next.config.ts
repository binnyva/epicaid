import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@epicaid/core", "@epicaid/db"],
};

export default config;
