import ExcelJS from "exceljs";
import { expect, test } from "vitest";
import { parseGlossaryWorkbook } from "../src/lib/import/parse-xlsx.js";

// 계획서 스케치(Task 14 Step 1)의 헬퍼를 그대로 가져온다. 헤더 8개는
// parse-xlsx.ts의 HEADER_ALIASES와 1:1로 매핑된다.
async function workbook(rows: (string | undefined)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["name_en", "name_ko", "full_name_en", "term_type", "domain", "status", "definition", "aliases"]);
  for (const row of rows) ws.addRow(row);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// --- 계획서 스케치의 5개 테스트(어댑트) ---

test("헤더를 인식하고 행을 파싱한다", async () => {
  const buf = await workbook([
    ["AE", "자동노출", "Auto Exposure", "abbreviation", "ISP", "active", "노출 자동 제어", "오토익스포저"],
  ]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);

  expect(errors).toEqual([]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    rowNumber: 2,
    nameEn: "AE",
    nameKo: "자동노출",
    fullNameEn: "Auto Exposure",
    termType: "abbreviation",
    domain: ["ISP"],
    status: "active",
    aliases: ["오토익스포저"],
  });
});

test("도메인과 별칭의 쉼표 구분을 분리한다", async () => {
  const buf = await workbook([["Gain", "게인", "", "term", "ISP, HW", "active", "", "gain value, 이득"]]);
  const { rows } = await parseGlossaryWorkbook(buf);

  expect(rows[0]!.domain).toEqual(["ISP", "HW"]);
  expect(rows[0]!.aliases).toEqual(["gain value", "이득"]);
});

test("표준 표기가 둘 다 비면 에러 행으로 분류한다", async () => {
  const buf = await workbook([["", "", "", "term", "ISP", "active", "설명만 있음", ""]]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);

  expect(rows).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]!.rowNumber).toBe(2);
});

test("알 수 없는 status는 draft로 떨어뜨린다", async () => {
  const buf = await workbook([["Gain", "", "", "term", "", "확인중", "", ""]]);
  const { rows } = await parseGlossaryWorkbook(buf);
  expect(rows[0]!.status).toBe("draft");
});

// R123: 계획서 원본 그대로("완전히 빈 행은 건너뛴다", ws.addRow([]))도 남겨
// 둔다 — 통과하는 것 자체는 맞다. 다만 이 테스트는 공허하다: exceljs의 기본
// eachRow는 셀이 하나도 안 잡힌 행을 아예 방문하지 않으므로, parse-xlsx.ts의
// "전부 빈 문자열이면 건너뛴다" 가드 줄을 통째로 지워도 이 테스트는 여전히
// 통과한다(아래 "빈 문자열 셀이 채워진 빈 행" 테스트로 실측 확인함 — 이
// 테스트만 지우면 실패하고, 이 테스트를 지워도 실패하지 않는다).
test("완전히 빈 행은 건너뛴다 (R123: 이 테스트 자체는 가드를 검증하지 못한다 — 아래 참고)", async () => {
  const buf = await workbook([[], ["Gain", "", "", "term", "", "active", "", ""]]);
  const { rows, errors } = await parseGlossaryWorkbook(buf);
  expect(rows).toHaveLength(1);
  expect(errors).toEqual([]);
});

// --- R123: 위 테스트를 대신할, 실제로 가드를 검증하는 테스트 ---

// exceljs-probe(직접 실행해 확인): ws.addRow(["", ""])처럼 칸을 명시적으로
// 채운 행은 기본 eachRow가 실제로 방문한다(rowNumber=2, values=["",""]).
// 이 행이 rows에도 errors에도 나타나지 않아야 "전부 빈 문자열이면 건너뛴다"
// 가드가 실제로 동작한 것이다. 헤더=1행, 빈-그러나-방문된 행=2행,
// 실데이터=3행 — 가드가 없으면 2행이 "표준 표기 둘 다 없음" 에러로 잡혀
// errors에 rowNumber 2가 나타난다.
test("R123: 셀이 채워졌지만 전부 빈 문자열인 행은 건너뛴다(방문되는 빈 행)", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["name_en", "name_ko"]);
  ws.addRow(["", ""]);
  ws.addRow(["Gain", ""]);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const { rows, errors } = await parseGlossaryWorkbook(buf);

  expect(errors).toEqual([]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ rowNumber: 3, nameEn: "Gain" });
});

// --- R122: 파일 단위 실패는 RowError가 아니라 별도 fileErrors로 분리된다 ---

test("R122: 워크시트가 없는 파일은 fileErrors에 담기고 rows/errors는 비어있다", async () => {
  const wb = new ExcelJS.Workbook();
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const result = await parseGlossaryWorkbook(buf);

  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.fileErrors).toEqual([{ message: "시트를 찾을 수 없습니다." }]);
  expect(result.ignoredHeaders).toEqual([]);
});

test("R122: 인식 가능한 헤더가 하나도 없으면 fileErrors에 담긴다", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["foo", "bar"]);
  ws.addRow(["x", "y"]);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const result = await parseGlossaryWorkbook(buf);

  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.fileErrors).toEqual([{ message: "인식 가능한 헤더가 없습니다." }]);
});

// --- R124: 인식 못 한 헤더는 조용히 사라지지 않고 리포트에 남는다 ---

test("R124: 인식하지 못한 헤더는 ignoredHeaders에 등장 순서대로, 중복 없이 남는다", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("glossary");
  ws.addRow(["name_en", "weird_col", "name_ko", "weird_col"]);
  ws.addRow(["Gain", "junk", "게인", "junk2"]);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const result = await parseGlossaryWorkbook(buf);

  expect(result.ignoredHeaders).toEqual(["weird_col"]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ nameEn: "Gain", nameKo: "게인" });
});
