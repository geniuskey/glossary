import { surfaceKeys } from "@glossary/db";

export interface NamedCandidate {
  nameEn: string | null;
  nameKo: string | null;
  fullNameEn?: string | null;
  fullNameKo?: string | null;
}

/**
 * 표기 하나를 여러 용어가 별칭으로 나눠 쓰면 `/g/<그 말>`은 동음이의 화면이 된다.
 * 그런데 그 말이 어느 한 용어의 이름이면, 사람들은 그 용어를 찾아온 것이다 — slugSeed가
 * 풀네임으로 slug를 만들기 때문에 대표명 주소는 늘 여기까지 내려온다. 대표명이 하나만
 * 맞으면 그 용어로, 대표명으로 갈리지 않으면 풀네임으로 한 번 더 가른다. 대표명을
 * 먼저 보는 이유: "PM"이 한 용어의 대표명이고 다른 용어의 풀네임 일부라도, 대표명으로
 * 부르는 쪽이 그 말의 주인이다. 같은 단계에서 둘 이상 맞으면 어느 쪽도 고르지 않는다.
 */
export function namedCandidate<T extends NamedCandidate>(text: string, candidates: readonly T[]): T | null {
  const key = surfaceKeys(text).normLoose;
  if (!key) return null;
  const same = (name: string | null | undefined) => !!name && surfaceKeys(name).normLoose === key;
  for (const fields of [["nameEn", "nameKo"], ["fullNameEn", "fullNameKo"]] as const) {
    const hits = candidates.filter((candidate) => fields.some((field) => same(candidate[field])));
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}
