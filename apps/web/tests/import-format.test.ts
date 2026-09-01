import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { surfaceKeys } from "@grossary/db";
import { expect, test } from "vitest";
import { TERM_STATUSES, TERM_TYPES } from "../src/lib/terms/enums.js";
import {
  ADDITIONAL_SURFACE_FIELDS,
  HEADER_TO_FIELD,
  IMPORT_COLUMNS,
  normalizeHeader,
  SAMPLE_ROWS,
  TEMPLATE_HREF,
  type ImportField,
} from "../src/lib/import/format.js";
import { buildImportTemplate } from "../src/lib/import/template.js";
import { parseGlossaryWorkbook } from "../src/lib/import/parse-xlsx.js";

// 화면 설명(import-guide.tsx) · 샘플 파일(template.ts) · 파서(parse-xlsx.ts)가
// 전부 format.ts를 읽게 바꿨다. 세 곳이 한 곳을 본다는 사실 자체는 tsc가
// 지켜 주지만, "적어 둔 헤더를 파서가 실제로 알아보는가"는 값의 문제라
// 여기서 실측한다 — 설명이 틀리면 없느니만 못하다.

const FIELDS: ImportField[] = [
  "nameEn",
  "nameKo",
  "fullNameEn",
  "fullNameKo",
  "termType",
  "domain",
  "category",
  "topic",
  "status",
  "definitionMd",
  "canonicalNames",
  "aliases",
  "abbreviations",
  "discouragedNames",
  "forbiddenNames",
];

test("IMPORT_COLUMNS는 파서가 채우는 필드를 하나도 빠짐없이 덮는다", () => {
  expect([...IMPORT_COLUMNS.map((c) => c.field)].sort()).toEqual([...FIELDS].sort());
});

test("추가 표기 안내는 편집 화면의 6종을 모두 가져올 수 있게 한다", () => {
  expect(ADDITIONAL_SURFACE_FIELDS).toEqual([
    "canonicalNames",
    "fullNameEn",
    "fullNameKo",
    "abbreviations",
    "aliases",
    "discouragedNames",
    "forbiddenNames",
  ]);
  for (const field of ADDITIONAL_SURFACE_FIELDS) {
    expect(IMPORT_COLUMNS.some((column) => column.field === field), field).toBe(true);
  }
});

test("otherHeaders는 이미 정규화된 형태다", () => {
  // 파서는 정규화한 헤더로만 표를 찾는다. "Name EN"처럼 적어 두면 화면에는
  // 그럴듯하게 보이지만 그 헤더로 만든 파일은 영원히 인식되지 않는다.
  for (const column of IMPORT_COLUMNS) {
    for (const header of column.otherHeaders) {
      expect(normalizeHeader(header), `${column.field}: ${header}`).toBe(header);
    }
  }
});

test("같은 헤더가 두 열로 매핑되지 않는다", () => {
  const all = IMPORT_COLUMNS.flatMap((c) => [normalizeHeader(c.header), ...c.otherHeaders]);
  expect(all).toHaveLength(new Set(all).size);
});

test("예전부터 인정하던 헤더는 하나도 사라지지 않았다", () => {
  // 이미 이 헤더로 만들어 둔 파일이 돌아다닌다 — 대표 헤더를 한글로 바꾸면서
  // 조용히 떨어뜨리면 그 파일들이 어느 날 통째로 "인식 가능한 헤더가 없습니다"가 된다.
  const legacy: Record<string, ImportField> = {
    name_en: "nameEn",
    영문: "nameEn",
    영문명: "nameEn",
    english: "nameEn",
    name_ko: "nameKo",
    한글: "nameKo",
    한글명: "nameKo",
    korean: "nameKo",
    full_name_en: "fullNameEn",
    풀네임: "fullNameEn",
    전체명: "fullNameEn",
    full_name_ko: "fullNameKo",
    term_type: "termType",
    종류: "termType",
    유형: "termType",
    domain: "domain",
    도메인: "domain",
    status: "status",
    상태: "status",
    definition: "definitionMd",
    정의: "definitionMd",
    설명: "definitionMd",
    aliases: "aliases",
    별칭: "aliases",
    약칭: "aliases",
    canonical_names: "canonicalNames",
    추가_표준명: "canonicalNames",
    discouraged: "discouragedNames",
    비권장: "discouragedNames",
    forbidden: "forbiddenNames",
    금지: "forbiddenNames",
  };
  for (const [header, field] of Object.entries(legacy)) {
    expect(HEADER_TO_FIELD[header], header).toBe(field);
  }
});

test("샘플 행의 종류·상태는 실제 enum 값이다", () => {
  // 빈 값 대신 아무 문자열이나 적어 두면 파서가 조용히 term/active로 떨어뜨려
  // "샘플대로 적었는데 종류가 안 들어간다"가 된다.
  for (const row of SAMPLE_ROWS) {
    expect(TERM_TYPES).toContain(row.termType);
    expect(TERM_STATUSES).toContain(row.status);
  }
});

test("샘플 행끼리 표기가 겹치지 않는다", () => {
  // 겹치면 샘플 파일을 그대로 검사만 돌려도 "파일 내 중복" 경고가 뜬다 —
  // 처음 써 보는 사람이 자기 실수인 줄 알고 헤맨다.
  const rowsByKey = new Map<string, Set<number>>();
  SAMPLE_ROWS.forEach((row, i) => {
    for (const text of [row.nameEn, row.nameKo, ...row.aliases.split(","), ...row.abbreviations.split(",")]) {
      const key = surfaceKeys(text.trim()).normLoose;
      if (!key) continue;
      rowsByKey.set(key, new Set([...(rowsByKey.get(key) ?? []), i]));
    }
  });

  const shared = [...rowsByKey.entries()].filter(([, rows]) => rows.size > 1).map(([key]) => key);
  expect(shared).toEqual([]);
});

test("샘플 파일은 데이터 시트가 먼저고 안내 시트가 뒤다", async () => {
  // 파서는 worksheets[0]만 읽는다. 안내 시트가 앞에 오면 샘플 파일 자신이
  // "인식 가능한 헤더가 없습니다"로 튕긴다.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildImportTemplate());
  expect(wb.worksheets.map((ws) => ws.name)).toEqual(["용어", "작성 안내"]);
});

test("TEMPLATE_HREF에 실제 라우트 파일이 있다", () => {
  // 내려받기 링크가 404가 되는 회귀는 화면을 열어 눌러 보기 전에는 안 보인다.
  const segments = TEMPLATE_HREF.split("/").filter(Boolean);
  const routeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", ...segments, "route.ts");
  expect(existsSync(routeFile), routeFile).toBe(true);
});

test("샘플 파일을 그대로 파서에 먹이면 경고 없이 SAMPLE_ROWS가 나온다", async () => {
  const result = await parseGlossaryWorkbook(await buildImportTemplate());

  expect(result.fileErrors).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.ignoredHeaders).toEqual([]);
  expect(result.rows).toHaveLength(SAMPLE_ROWS.length);

  SAMPLE_ROWS.forEach((sample, i) => {
    const parsed = result.rows[i]!;
    expect(parsed.rowNumber).toBe(i + 2);
    expect(parsed.termType).toBe(sample.termType);
    expect(parsed.status).toBe(sample.status);
    expect(parsed.nameEn ?? "").toBe(sample.nameEn);
    expect(parsed.nameKo ?? "").toBe(sample.nameKo);
    expect(parsed.fullNameEn ?? "").toBe(sample.fullNameEn);
    expect(parsed.fullNameKo ?? "").toBe(sample.fullNameKo);
    expect(parsed.definitionMd ?? "").toBe(sample.definitionMd);
    expect(parsed.domain.join(", ")).toBe(sample.domain);
    expect(parsed.category ?? "").toBe(sample.category);
    expect(parsed.topic ?? "").toBe(sample.topic);
    expect(parsed.aliases.join(", ")).toBe(sample.aliases);
    expect(parsed.abbreviations.join(", ")).toBe(sample.abbreviations);
    expect(parsed.canonicalNames.join(", ")).toBe(sample.canonicalNames);
    expect(parsed.discouragedNames.join(", ")).toBe(sample.discouragedNames);
    expect(parsed.forbiddenNames.join(", ")).toBe(sample.forbiddenNames);
  });
});

test("샘플 파일의 1행은 대표 헤더 그대로다", async () => {
  // 화면 미리보기(SamplePreview)가 그리는 머리글과 실제 파일의 1행이 같아야
  // "미리보기대로 적으면 된다"는 말이 사실이 된다.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildImportTemplate());
  const header = wb.worksheets[0]!.getRow(1);
  expect(IMPORT_COLUMNS.map((_, i) => String(header.getCell(i + 1).value))).toEqual(
    IMPORT_COLUMNS.map((c) => c.header),
  );
});
