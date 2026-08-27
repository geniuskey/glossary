import { surfaceKeys } from "@grossary/db";
import { createTerm, findDuplicates } from "@/lib/terms/create";
import type { ImportRow, RowError } from "./parse-xlsx";

/** R119: 한 번의 임포트 요청이 처리할 수 있는 최대 행 수. */
export const MAX_IMPORT_ROWS = 5000;

export interface ImportConflict {
  rowNumber: number;
  name: string;
  // R122: 한 행이 기존 용어 여러 개와 겹쳐도(예: 표준 이름과 별칭이 각각 다른
  // 기존 용어와 충돌) 행 하나당 리포트 항목 하나로 묶는다. 계획서 스케치처럼
  // 경고 개수만큼 같은 rowNumber를 여러 번 싣으면, "conflicts.length"가 실제
  // 충돌 행 수가 아니게 되고 화면도 같은 행을 여러 줄로 반복해서 보여준다.
  conflictingSlugs: string[];
}

export interface ImportReport {
  total: number;
  // R117: "파싱된 행 수"가 아니라 "충돌도 파일 내 중복도 없어서 그대로 반영
  // 가능한 행 수"다 — 화면의 "{ready}개 실제로 등록하기" 버튼 문구가 실제
  // 동작과 일치하려면 이 정의가 맞아야 한다.
  ready: number;
  conflicts: ImportConflict[];
  duplicatesInFile: { key: string; rowNumbers: number[] }[];
  errors: RowError[];
}

function displayName(row: ImportRow): string {
  return row.nameEn ?? row.nameKo ?? "";
}

interface RowSurface {
  text: string;
  lang: "en" | "ko" | "neutral";
  kind: "canonical" | "alias";
}

/**
 * 충돌/중복 판정에 쓰는 표기 전체(표준 이름 + 별칭). createTerm에 실제로
 * 넘기는 표기 목록과는 다르다 — createTerm은 nameEn/nameKo로부터 canonical을
 * 스스로 파생하므로(deriveSurfaces), 여기서 다시 canonical을 surfaces 배열에
 * 넣어 넘기면 같은 정규화 키가 두 번 들어가 R45의 충돌 검증을 잘못 건드린다.
 * 판정 전용으로만 쓰고 저장 페이로드에는 절대 재사용하지 않는다.
 */
function verdictSurfacesOf(row: ImportRow): RowSurface[] {
  return [
    ...(row.nameEn ? [{ text: row.nameEn, lang: "en" as const, kind: "canonical" as const }] : []),
    ...(row.nameKo ? [{ text: row.nameKo, lang: "ko" as const, kind: "canonical" as const }] : []),
    ...row.aliases.map((a) => ({ text: a, lang: "neutral" as const, kind: "alias" as const })),
  ];
}

interface Verdict {
  conflictRowNumbers: Set<number>;
  duplicateRowNumbers: Set<number>;
  conflicts: ImportConflict[];
  duplicatesInFile: ImportReport["duplicatesInFile"];
}

/**
 * R119: dryRunImport와 applyImport가 각각 자기 나름으로 "행 하나마다
 * findDuplicates를 한 번씩" 부르면(계획서 스케치의 방식) 5,000행 파일에
 * 5,000번 순차 DB 왕복이 생긴다. 여기서는 모든 행의 모든 표기를 한 번에
 * 모아 findDuplicates를 단 한 번만 호출한다(findDuplicates 자체가 이미
 * `inArray(...)` 단일 쿼리로 구현돼 있다 — create.ts:59). lookup.ts의
 * fetchSimilar가 unnest로 배치 조회하는 것과 같은 원칙이지만, 여기서는
 * 이미 배치를 받는 기존 함수(findDuplicates)가 있어 그걸 그대로 재사용할 수
 * 있었다 — 새 SQL을 쓸 필요가 없었다.
 */
async function computeVerdict(rows: ImportRow[]): Promise<Verdict> {
  const seen = new Map<string, number[]>();
  for (const row of rows) {
    for (const s of verdictSurfacesOf(row)) {
      const key = surfaceKeys(s.text).normLoose;
      if (!key) continue;
      seen.set(key, [...(seen.get(key) ?? []), row.rowNumber]);
    }
  }
  const duplicatesInFile = [...seen.entries()]
    .filter(([, numbers]) => new Set(numbers).size > 1)
    .map(([key, numbers]) => ({ key, rowNumbers: [...new Set(numbers)].sort((a, b) => a - b) }));
  const duplicateRowNumbers = new Set(duplicatesInFile.flatMap((d) => d.rowNumbers));

  const allSurfaces = rows.flatMap((row) => verdictSurfacesOf(row));
  const warnings = allSurfaces.length ? await findDuplicates(allSurfaces) : [];

  const warningsByKey = new Map<string, typeof warnings>();
  for (const w of warnings) {
    const bucket = warningsByKey.get(w.normLoose) ?? [];
    bucket.push(w);
    warningsByKey.set(w.normLoose, bucket);
  }

  const conflictsByRow = new Map<number, { name: string; slugs: Set<string> }>();
  for (const row of rows) {
    for (const s of verdictSurfacesOf(row)) {
      const key = surfaceKeys(s.text).normLoose;
      if (!key) continue;
      const matches = warningsByKey.get(key);
      if (!matches) continue;
      const entry = conflictsByRow.get(row.rowNumber) ?? { name: displayName(row), slugs: new Set<string>() };
      for (const m of matches) entry.slugs.add(m.conflictingSlug);
      conflictsByRow.set(row.rowNumber, entry);
    }
  }

  const conflicts = [...conflictsByRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rowNumber, v]) => ({ rowNumber, name: v.name, conflictingSlugs: [...v.slugs].sort() }));
  const conflictRowNumbers = new Set(conflicts.map((c) => c.rowNumber));

  return { conflictRowNumbers, duplicateRowNumbers, conflicts, duplicatesInFile };
}

export async function dryRunImport(rows: ImportRow[], errors: RowError[]): Promise<ImportReport> {
  const { conflicts, duplicatesInFile, conflictRowNumbers, duplicateRowNumbers } = await computeVerdict(rows);
  const blocked = new Set([...conflictRowNumbers, ...duplicateRowNumbers]);
  const ready = rows.filter((r) => !blocked.has(r.rowNumber)).length;

  return {
    total: rows.length + errors.length,
    ready,
    conflicts,
    duplicatesInFile,
    errors,
  };
}

export interface ApplySkip {
  rowNumber: number;
  reason: "conflict" | "duplicate_in_file";
}

export interface ApplyResult {
  created: number;
  skipped: ApplySkip[];
}

/**
 * R117: 반영은 dry-run이 무엇을 경고했는지 클라이언트가 넘겨주는 값을 절대
 * 신뢰하지 않는다 — 매번 자기 스스로 같은 판정(computeVerdict)을 다시
 * 계산해서 충돌/파일 내 중복 행을 기본적으로 건너뛴다. 이렇게 해야 dry-run을
 * 아예 건너뛰고 바로 반영을 호출해도(또는 두 요청 사이에 DB 상태가 바뀌어도)
 * 안전하다. forceRowNumbers에 명시적으로 담긴 행만 예외로 그대로 등록한다 —
 * 동음이의어는 합법이므로 강제 경로 자체는 남겨두되, 기본값은 항상 "건너뛴다"다.
 *
 * R120: authorKeyId를 마지막 인자까지 받아 createTerm에 그대로 전달한다 —
 * API 키로 임포트해도 리비전에 작성자가 남는다(Task 13 R115가 기대하는
 * 이력 추적을 임포트 경로에서도 지킨다).
 */
export async function applyImport(
  rows: ImportRow[],
  authorId: string | null,
  authorKeyId: string | null = null,
  forceRowNumbers: ReadonlySet<number> = new Set(),
): Promise<ApplyResult> {
  const { conflictRowNumbers, duplicateRowNumbers } = await computeVerdict(rows);

  let created = 0;
  const skipped: ApplySkip[] = [];

  for (const row of rows) {
    if (!forceRowNumbers.has(row.rowNumber)) {
      if (conflictRowNumbers.has(row.rowNumber)) {
        skipped.push({ rowNumber: row.rowNumber, reason: "conflict" });
        continue;
      }
      if (duplicateRowNumbers.has(row.rowNumber)) {
        skipped.push({ rowNumber: row.rowNumber, reason: "duplicate_in_file" });
        continue;
      }
    }

    await createTerm(
      {
        termType: row.termType,
        nameEn: row.nameEn,
        nameKo: row.nameKo,
        fullNameEn: row.fullNameEn,
        fullNameKo: row.fullNameKo,
        domain: row.domain,
        status: row.status,
        definitionMd: row.definitionMd,
        surfaces: row.aliases.map((a) => ({ text: a, lang: "neutral" as const, kind: "alias" as const })),
      },
      authorId,
      authorKeyId,
    );
    created += 1;
  }

  return { created, skipped };
}
