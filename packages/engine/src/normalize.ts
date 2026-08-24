export interface NormalizedSurface {
  /** 구분자를 모두 제거한 키. "auto-exposure" -> "autoexposure" */
  loose: string;
  /** 구분자를 단일 공백으로 축약한 키. "auto-exposure" -> "auto exposure" */
  space: string;
}

const SEPARATORS = /[\s\-_/.·・]+/g;

function splitCamelCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function normalizeSurface(text: string): NormalizedSurface {
  const nfkc = text.normalize("NFKC");
  const spaced = splitCamelCase(nfkc)
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .trim();

  return { loose: spaced.replace(/ /g, ""), space: spaced };
}
