import type { SurfaceLangLiteral } from "./enums";

const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const LATIN_PATTERN = /[a-z]/i;

/**
 * 표기 문자열만으로 저장 언어를 결정한다.
 * 한글과 영문이 섞인 현업 표기(A컷, e커머스)는 국문 문맥으로 보고,
 * 한글 없이 라틴 문자가 있으면 영문, 숫자·기호만 있으면 공통으로 분류한다.
 */
export function inferSurfaceLang(text: string): SurfaceLangLiteral {
  if (HANGUL_PATTERN.test(text)) return "ko";
  if (LATIN_PATTERN.test(text)) return "en";
  return "neutral";
}
