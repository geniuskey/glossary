import { sql } from "drizzle-orm";
import { domains, type Db } from "@glossary/db";
import { firstUnusedDomainColor } from "./domain-colors";
import { domainLabelKey, normalizeDomainLabel } from "./domain-label";
import { slugify } from "./slug";

// domains.ts는 server-only라 tsx로 도는 시드 스크립트가 import할 수 없다.
// 스크립트와 서버가 같은 키·색상 배정 규칙을 쓰도록 여기로 뺐다.

export function uniqueDomainKey(label: string, taken: ReadonlySet<string>): string {
  const base = slugify(label).slice(0, 64) || "domain";
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 63 - String(suffix).length))}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 분류 체계에 없는 도메인을 등록하고, 새로 만든 label을 돌려준다. 시드처럼
 * 도메인 목록이 코드에 고정된 쓰기 경로 전용이다 — 시드가 이걸 건너뛰면
 * 분류 체계 밖 도메인을 단 용어가 생기고, 그 용어는 편집 화면에서 저장이
 * 막힌다. 사용자가 올린 파일은 팔레트(24칸)를 채울 수 있어 여기로 보내지 않고
 * 가져오기 단계에서 거절한다(parse-xlsx.ts).
 */
export async function ensureDomains(db: Db, labels: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(labels.map(normalizeDomainLabel).filter(Boolean))];
  if (wanted.length === 0) return [];
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('glossary_domain_catalog'))`);
    const current = await tx
      .select({ key: domains.key, label: domains.label, color: domains.color, sortOrder: domains.sortOrder })
      .from(domains);
    const knownLabels = new Set(current.map((domain) => domainLabelKey(domain.label)));
    const keys = new Set(current.map((domain) => domain.key));
    const colors = new Set(current.map((domain) => domain.color));
    let sortOrder = Math.max(-1, ...current.map((domain) => domain.sortOrder)) + 1;
    const created: string[] = [];
    for (const label of wanted) {
      if (knownLabels.has(domainLabelKey(label))) continue;
      const color = firstUnusedDomainColor(colors);
      if (!color) throw new Error(`도메인 색상 팔레트가 가득 차 ‘${label}’ 도메인을 추가할 수 없습니다.`);
      const key = uniqueDomainKey(label, keys);
      await tx.insert(domains).values({ key, label, color, sortOrder });
      keys.add(key);
      colors.add(color);
      knownLabels.add(domainLabelKey(label));
      sortOrder += 1;
      created.push(label);
    }
    return created;
  });
}
