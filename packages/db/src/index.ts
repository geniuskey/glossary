import { normalizeSurface } from "@glossary/engine";

// 상대 임포트에 .js 확장자를 붙이지 않는다. 이 패키지는 dist 없는 소스 전용이라
// drizzle-kit(CJS 로더)과 Next의 Turbopack이 그대로 읽는데, 둘 다 .js -> .ts 매핑을
// 못 한다. tsconfig가 moduleResolution: "Bundler"라 확장자 생략이 정식 표기다.

export * from "./schema/index";
export { createDb } from "./client";
export type { Db } from "./client";

/**
 * 표기 정규화 컬럼 값을 만든다.
 * 정규화 규칙 자체는 @glossary/engine이 소유한다. 여기서 재구현하지 말 것.
 */
export function surfaceKeys(text: string): { normLoose: string; normSpace: string } {
  const { loose, space } = normalizeSurface(text);
  return { normLoose: loose, normSpace: space };
}
