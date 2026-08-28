import path from "node:path";
import type { NextConfig } from "next";

// .env는 저장소 루트에 하나만 둔다(운영 안내서·getting-started의 전제).
// 하지만 next dev는 apps/web에서 돌고 Next.js는 자기 디렉터리의 .env만
// 자동 로드하므로, 루트 .env를 여기서 직접 읽어 process.env에 채운다.
// 운영(compose)에서는 이 파일이 없고 값이 컨테이너 환경으로 주어지므로,
// 없거나 이미 채워진 경우는 조용히 넘어간다.
const rootEnv = path.join(import.meta.dirname, "../../.env");
try {
  process.loadEnvFile(rootEnv);
} catch {
  // 파일이 없으면(운영·CI) 컨테이너/셸 환경변수를 그대로 쓴다.
}

const config: NextConfig = {
  output: "standalone",
  // 모노레포에서는 트레이싱 루트를 워크스페이스 최상단으로 올려야
  // standalone 번들에 packages/*가 포함된다.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@grossary/db", "@grossary/engine"],
};

export default config;
