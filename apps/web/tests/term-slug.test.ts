import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, terms, termSlugAliases } from "@glossary/db";
import { createTerm } from "../src/lib/terms/create.js";
import { getTermByIdOrSlug, termIdsBySlug } from "../src/lib/terms/query.js";
import { pickSlug, slugSeed } from "../src/lib/terms/slug.js";
import { TERM_SLUG_MAX } from "../src/lib/terms/limits.js";
import { updateTerm } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);

async function purge() {
  await db.delete(terms).where(like(terms.slug, "slugprobe%"));
}

beforeAll(purge);
afterAll(purge);

test("slug는 약어가 아니라 풀네임에서 만든다", () => {
  expect(slugSeed({ nameEn: "SLA", fullNameEn: "Service Level Agreement" })).toBe("service-level-agreement");
  expect(slugSeed({ nameEn: "Gain", fullNameEn: null })).toBe("gain");
  expect(slugSeed({ nameEn: null, nameKo: "노출" })).toBe("노출");
  expect(slugSeed({ nameEn: "---" })).toBe("term");
});

test("겹치면 번호보다 분야 한정어를 먼저 쓴다", () => {
  const taken = new Set(["pod"]);
  expect(pickSlug("pod", ["Kubernetes"], (s) => taken.has(s))).toBe("pod-kubernetes");
  taken.add("pod-kubernetes");
  expect(pickSlug("pod", ["Kubernetes", "반도체"], (s) => taken.has(s))).toBe("pod-반도체");
  taken.add("pod-반도체");
  expect(pickSlug("pod", ["Kubernetes", "반도체"], (s) => taken.has(s))).toBe("pod-kubernetes-2");
  expect(pickSlug("pod", [], (s) => taken.has(s))).toBe("pod-2");
});

test("예약어·UUID 모양은 비어 있어도 쓰지 않는다", () => {
  expect(pickSlug("new", [], () => false)).toBe("new-2");
  expect(pickSlug("550e8400-e29b-41d4-a716-446655440000", ["ISP"], () => false)).toBe("550e8400-e29b-41d4-a716-446655440000-isp");
});

test("한정어·번호를 붙여도 slug 길이 상한을 넘지 않는다", () => {
  const seed = "a".repeat(TERM_SLUG_MAX);
  expect(pickSlug(seed, ["kubernetes"], (s) => s === seed).length).toBeLessThanOrEqual(TERM_SLUG_MAX);
  expect(pickSlug(seed, [], (s) => s === seed).length).toBeLessThanOrEqual(TERM_SLUG_MAX);
});

test("같은 약어의 두 개념은 각자 풀네임 slug를 받는다", async () => {
  const a = await createTerm({ nameEn: "SPX", fullNameEn: "Slugprobe Service Exchange", domain: [], status: "active", surfaces: [] }, null);
  const b = await createTerm({ nameEn: "SPX", fullNameEn: "Slugprobe Signal Extension", domain: [], status: "active", surfaces: [] }, null);
  expect(a.term.slug).toBe("slugprobe-service-exchange");
  expect(b.term.slug).toBe("slugprobe-signal-extension");
});

test("slug를 바꾸면 옛 slug로도 찾고, 다른 용어가 옛 slug를 가져가지 못한다", async () => {
  const { term } = await createTerm({ nameEn: "Slugprobe Old", domain: [], status: "active", surfaces: [] }, null);
  const renamed = await updateTerm(term.id, { slug: "slugprobe-renamed" }, null);
  expect("term" in renamed && renamed.term.slug).toBe("slugprobe-renamed");

  expect((await getTermByIdOrSlug("slugprobe-old"))?.id).toBe(term.id);
  expect((await termIdsBySlug(["slugprobe-old"])).get("slugprobe-old")).toBe(term.id);

  const other = await createTerm({ nameEn: "Slugprobe Old", domain: [], status: "active", surfaces: [] }, null);
  expect(other.term.slug).toBe("slugprobe-old-2");
  expect(await updateTerm(other.term.id, { slug: "slugprobe-old" }, null)).toEqual({ slugConflict: true });

  const reverted = await updateTerm(term.id, { slug: "slugprobe-old" }, null);
  expect("term" in reverted && reverted.term.slug).toBe("slugprobe-old");
  const aliases = await db.select().from(termSlugAliases).where(eq(termSlugAliases.termId, term.id));
  expect(aliases.map((a) => a.slug)).toEqual(["slugprobe-renamed"]);
});
