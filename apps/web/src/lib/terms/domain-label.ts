// 도메인 이름 비교 규칙의 유일한 소유자. 분류 체계 등록·가져오기·용어 저장이
// 각자 `===`나 SQL `IN`으로 따로 비교하던 시절에는, 화면에 똑같이 "일반"으로
// 보이는 값이 NFC/NFD(엑셀·macOS에서 흔하다), 끝의 NBSP·전각 공백, 대소문자
// 차이만으로 서로 달라 "분류 체계에 없는 도메인" 400이 났다 — payload도 DB
// 목록도 멀쩡해 보여서 원인을 끝내 찾지 못했다. 비교는 항상 여기 키로 한다.

/** 저장할 때 쓰는 형태. JS trim은 NBSP·전각 공백까지 지우지만 Postgres btrim은 공백만 지운다. */
export function normalizeDomainLabel(label: string): string {
  return label.normalize("NFC").trim();
}

/** 같은 도메인인지 판정하는 키. createDomain의 중복 검사도 대소문자를 무시한다. */
export function domainLabelKey(label: string): string {
  return normalizeDomainLabel(label).toLocaleLowerCase("ko");
}

/**
 * 편집 폼은 도메인 목록을 쉼표로 이어 들고 있다가 저장할 때 다시 쪼갠다
 * (form-payload.ts). 이름에 쉼표가 들어가면 저장 요청에서 두 조각이 되어
 * 분류 체계와 영영 맞지 않는다.
 */
export const DOMAIN_LABEL_FORBIDDEN_MESSAGE = "도메인 이름에는 쉼표(,)를 쓸 수 없습니다.";
export function isValidDomainLabel(label: string): boolean {
  return !label.includes(",");
}

export interface ResolvedDomains {
  /** 분류 체계에 적힌 그대로의 이름(중복 제거, 입력 순서 유지). 저장에는 이 값을 쓴다. */
  labels: string[];
  unknown: string[];
}

/**
 * 입력 도메인을 분류 체계 이름으로 바꾼다. `kept`는 이 용어에 이미 붙어 있던
 * 값이다 — 편집 폼은 도메인을 건드리지 않아도 배열 전체를 다시 보내므로,
 * 이미 붙어 있던 값까지 분류 체계와 대조하면 가져오기·시드로 들어온 값이 붙은
 * 용어는 정의 한 줄 고치는 저장까지 막힌다.
 */
export function resolveDomainLabels(
  labels: readonly string[],
  catalog: readonly string[],
  kept: readonly string[] = [],
): ResolvedDomains {
  const catalogByKey = new Map(catalog.map((label) => [domainLabelKey(label), label]));
  const keptByKey = new Map(kept.map((label) => [domainLabelKey(label), label]));
  const resolved: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const key = domainLabelKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = catalogByKey.get(key) ?? keptByKey.get(key);
    if (label === undefined) unknown.push(normalizeDomainLabel(raw));
    else resolved.push(label);
  }
  return { labels: resolved, unknown };
}

export function unknownDomainsMessage(unknown: readonly string[]): string {
  return `분류 체계에 없는 도메인이 포함되어 있습니다: ${unknown.map((label) => `‘${label}’`).join(", ")}`;
}
