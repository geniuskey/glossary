import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // 모노레포에서는 트레이싱 루트를 워크스페이스 최상단으로 올려야
  // standalone 번들에 packages/*가 포함된다.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@grossary/db", "@grossary/engine"],
  // @grossary/db는 소스 전용 패키지로, "./client.js" 처럼 .ts 파일을
  // .js 확장자로 상대 임포트한다(TS NodeNext 관례). webpack은 기본적으로
  // 이를 풀지 못하므로 extensionAlias로 .js 요청 시 .ts도 함께 시도하게 한다.
  // 주의: Turbopack은 experimental.extensionAlias를 지원하지 않는다
  // (node_modules/next/dist/lib/turbopack-warning.js의 unsupported 목록 참고).
  // 그래서 dev/build 스크립트를 --webpack으로 고정했다. 자세한 내용은
  // task-5-report.md 참고.
  experimental: {
    extensionAlias: {
      ".js": [".js", ".ts", ".tsx"],
    },
  },
};

export default config;
