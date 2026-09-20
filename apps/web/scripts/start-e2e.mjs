import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(appRoot, ".next", "standalone", "apps", "web");
const serverFile = path.join(standaloneRoot, "server.js");

if (!existsSync(serverFile)) {
  throw new Error("standalone 빌드가 없습니다. 먼저 저장소 루트에서 pnpm build를 실행하세요.");
}

// Next.js standalone 출력은 CDN 배포를 전제로 정적 파일을 복사하지 않는다. E2E는
// 브라우저 hydration까지 확인해야 하므로 공식 배포 안내와 같은 위치로 복사한다.
const staticSource = path.join(appRoot, ".next", "static");
if (existsSync(staticSource)) {
  cpSync(staticSource, path.join(standaloneRoot, ".next", "static"), { recursive: true, force: true });
}
const publicSource = path.join(appRoot, "public");
if (existsSync(publicSource)) {
  cpSync(publicSource, path.join(standaloneRoot, "public"), { recursive: true, force: true });
}

const child = spawn(process.execPath, [serverFile], {
  cwd: standaloneRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
    PORT: process.env.PORT || "3200",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  throw error;
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
