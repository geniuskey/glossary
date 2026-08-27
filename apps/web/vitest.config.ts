import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // R109/R110(Task 13): jsdom은 여전히 없다(렌더/이벤트 테스트는 여전히
  // 불가능 — vitest.config.ts의 "no jsdom" 결정은 그대로 유지). 이 esbuild
  // 옵션은 그거와 무관하게, Server Component(app/**/page.tsx)를 평범한 async
  // 함수로 직접 호출해서 반환된 React 엘리먼트 트리(순수 객체, DOM 아님)를
  // 검사하는 테스트를 가능하게 한다 — JSX가 기본 classic 변환으로
  // React.createElement(...)를 참조 오류 없이 내보내려면 automatic 런타임이
  // 필요하다(react 17+ jsx-runtime, 이미 의존성에 존재).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
  },
});
