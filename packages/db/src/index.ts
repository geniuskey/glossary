import { normalizeSurface } from "@grossary/engine";

export * from "./schema/index.js";
export { createDb } from "./client.js";
export type { Db } from "./client.js";

/**
 * 표기 정규화 컬럼 값을 만든다.
 * 정규화 규칙 자체는 @grossary/engine이 소유한다. 여기서 재구현하지 말 것.
 */
export function surfaceKeys(text: string): { normLoose: string; normSpace: string } {
  const { loose, space } = normalizeSurface(text);
  return { normLoose: loose, normSpace: space };
}
