import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { legacyRedirects } from "../next.config.js";

// R135: 옛 `/terms/*` 주소는 next.config.ts의 리다이렉트로만 살아 있다 — 그
// 목적지에 해당하는 화면이 실제로 있는지 확인해 주는 것은 아무것도 없다.
// 목적지 이름을 잘못 적거나 나중에 화면을 또 옮기면, 리다이렉트는 조용히
// 성공하고 사용자만 404를 본다(리다이렉트 자체는 파일시스템을 보지 않는다).
// 손으로 유지되는 두 곳(리다이렉트 표, 라우트 디렉터리)을 여기서 묶는다.

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");

/** `/edit/:slug` → `src/app/edit/[slug]/page.tsx` */
function pageFileFor(destination: string): string {
  const segments = destination
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith(":") ? `[${seg.slice(1)}]` : seg));
  return path.join(appDir, ...segments, "page.tsx");
}

test("R135: 옛 주소 리다이렉트의 목적지에는 실제 화면이 있다", () => {
  expect(legacyRedirects.length).toBeGreaterThan(0); // vacuity 가드

  for (const r of legacyRedirects) {
    expect(existsSync(pageFileFor(r.destination)), `${r.source} → ${r.destination}: 화면 없음`).toBe(true);
  }
});

test("R135: 옛 주소는 전부 영구(308) 리다이렉트다", () => {
  // 임시(307)로 두면 검색엔진과 브라우저가 옛 주소를 계속 정답으로 들고 있다.
  for (const r of legacyRedirects) {
    expect(r.permanent, `${r.source}`).toBe(true);
  }
});

test("R135: app/terms/ 화면 디렉터리는 없다", () => {
  // 있으면 리다이렉트 표와 라우트가 같은 주소를 두고 경쟁한다(리다이렉트가
  // 먼저 검사되므로 라우트는 영영 실행되지 않는, 읽는 사람만 헷갈리는 상태).
  expect(existsSync(path.join(appDir, "terms"))).toBe(false);
});

// 리다이렉트는 위에서부터 처음 맞는 것 하나만 적용된다 — `/terms/:slug`가
// `/terms/new`보다 위에 있으면 생성 폼 링크가 `/w/new`로 가 버린다. 각 source를
// 자기 자신으로 조회했을 때 처음 맞는 규칙이 자기 자신인지로 순서를 잠근다.
function sourceMatcher(source: string): RegExp {
  const pattern = source
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^/${pattern}$`);
}

test("R135: 좁은 규칙이 넓은 규칙보다 먼저 온다 (/terms/new가 /terms/:slug에 먹히지 않는다)", () => {
  for (const r of legacyRedirects) {
    // `:slug`가 들어간 source는 구체적인 값으로 바꿔야 실제 요청 경로가 된다.
    const probe = r.source.replace(/:[^/]+/g, "probe-slug");
    const first = legacyRedirects.find((candidate) => sourceMatcher(candidate.source).test(probe));
    expect(first?.source, `${probe}는 ${first?.source}에 먼저 걸린다`).toBe(r.source);
  }
});

test("R135 자기검사: 순서가 뒤집힌 표는 위 판정을 통과하지 못한다", () => {
  const flipped = [
    { source: "/terms/:slug", destination: "/w/:slug" },
    { source: "/terms/new", destination: "/new" },
  ];
  const first = flipped.find((c) => sourceMatcher(c.source).test("/terms/new"));
  expect(first?.source).toBe("/terms/:slug");
});
