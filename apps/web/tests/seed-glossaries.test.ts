import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceKeys } from "@glossary/db";
import { expect, test } from "vitest";
import { SEED_PACKS, packByKey } from "../src/lib/seed/glossaries.js";
import { termInputSchema } from "../src/lib/terms/schema.js";
import { deriveSurfaces } from "../src/lib/terms/surfaces.js";
import { RESERVED_SLUGS } from "../src/lib/terms/create.js";
import { slugify } from "../src/lib/terms/slug.js";

// 씨앗 데이터는 손으로 적은 90여 줄이라 오타 하나가 스크립트를 반쯤 돌다
// 멈추게 한다 — 그 시점엔 이미 절반이 DB에 들어가 있다. 여기서 DB 없이
// 같은 검사를 미리 돌려 그런 실행이 아예 시작되지 않게 한다.

const ALL = SEED_PACKS.flatMap((pack) => pack.terms.map((term) => ({ pack, term })));

test("모든 씨앗 용어가 termInputSchema를 통과한다", () => {
  const failed: string[] = [];
  for (const { pack, term } of ALL) {
    const parsed = termInputSchema.safeParse({
      nameEn: term.nameEn ?? null,
      nameKo: term.nameKo ?? null,
      fullNameEn: term.fullNameEn ?? null,
      fullNameKo: term.fullNameKo ?? null,
      domain: [...pack.domain],
      status: "active",
      definitionMd: term.definitionMd,
      surfaces: (term.aliases ?? []).map((text) => ({ text, kind: "alias" })),
    });
    if (!parsed.success) failed.push(`${pack.key}/${term.nameEn ?? term.nameKo}`);
  }
  expect(failed).toEqual([]);
});

test("씨앗 용어끼리 표기가 겹치지 않는다", () => {
  // 겹치면 seed-terms.ts가 먼저 들어간 쪽만 넣고 나머지를 "이미 있음"으로
  // 건너뛴다. 조용히 개수만 모자라는 결과가 되어 알아채기 어렵다.
  const owners = new Map<string, Set<string>>();
  for (const { pack, term } of ALL) {
    const input = termInputSchema.parse({
      nameEn: term.nameEn ?? null,
      nameKo: term.nameKo ?? null,
      fullNameEn: term.fullNameEn ?? null,
      fullNameKo: term.fullNameKo ?? null,
      domain: [...pack.domain],
      status: "active",
      definitionMd: term.definitionMd,
      surfaces: (term.aliases ?? []).map((text) => ({ text, kind: "alias" })),
    });
    const label = `${pack.key}/${term.nameEn ?? term.nameKo}`;
    for (const surface of deriveSurfaces(input, input.surfaces)) {
      const key = surfaceKeys(surface.text).normLoose;
      if (!key) continue;
      owners.set(key, new Set([...(owners.get(key) ?? []), label]));
    }
  }

  const shared = [...owners.entries()].filter(([, labels]) => labels.size > 1);
  expect(shared.map(([key, labels]) => `${key}: ${[...labels].join(" / ")}`)).toEqual([]);
});

test("씨앗 용어의 슬러그가 예약어와 겹치지 않는다", () => {
  // uniqueSlug가 접미사를 붙여 피해 주긴 하지만, 예시로 제공하는 묶음이
  // /terms/lookup-2 같은 주소를 갖는 건 첫인상으로 이상하다.
  const reserved = ALL
    .map(({ term }) => slugify(term.nameEn ?? term.nameKo ?? ""))
    .filter((slug) => RESERVED_SLUGS.has(slug));
  expect(reserved).toEqual([]);
});

test("묶음 키는 서로 다르고 packByKey로 찾힌다", () => {
  const keys = SEED_PACKS.map((p) => p.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const key of keys) expect(packByKey(key)?.key).toBe(key);
  expect(packByKey("없는묶음")).toBeUndefined();
});

test("seed-terms 명령이 문서에 적혀 있다", () => {
  // 명령이 있어도 아무도 모르면 표는 계속 비어 있다. 문서와 스크립트 이름이
  // 어긋나는 회귀는 문서를 열어 보기 전엔 안 보인다.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const guide = readFileSync(path.join(root, "docs/guide/getting-started.md"), "utf8");
  expect(guide).toContain("scripts/seed-terms.ts");
  for (const pack of SEED_PACKS) expect(guide).toContain(pack.key);
});
