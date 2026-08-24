import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // 모노레포에서는 트레이싱 루트를 워크스페이스 최상단으로 올려야
  // standalone 번들에 packages/*가 포함된다.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@grossary/db", "@grossary/engine"],
};

export default config;
