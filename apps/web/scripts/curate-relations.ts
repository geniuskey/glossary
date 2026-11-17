import path from "node:path";
import { eq } from "drizzle-orm";
import { users } from "@glossary/db";
import { getDb } from "../src/lib/db.js";
import { loadAiConfig, runtimeAiConfig } from "../src/lib/ai/config.js";
import { curateTermRelations } from "../src/lib/ai/relation-curation.js";
import { loadDiscoveryGraph } from "../src/lib/discovery/load.js";
import { selectConceptTerms } from "../src/lib/discovery/curation.js";

// seed-terms.ts와 같은 이유로 루트 .env를 직접 읽는다.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 운영·CI는 셸 환경변수를 쓴다.
}

/**
 * 개념 용어의 관계를 AI로 정리해 proposed 관계로 쌓는다. 승인은 화면의 관계 검토에서 사람이 한다.
 *
 *   tsx --conditions=react-server scripts/curate-relations.ts --as admin@example.com [--limit 100] [--domain 라벨] [--apply]
 *
 * --apply가 없으면 미리보기만 출력하고 아무것도 저장하지 않는다. RAG 임베딩 색인이 있어야 후보가 나온다.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const email = arg("as");
if (!email) {
  console.error("사용법: curate-relations.ts --as <제안자 이메일> [--limit N] [--domain 라벨] [--apply]");
  process.exit(2);
}
const apply = process.argv.includes("--apply");
const limit = Math.max(1, Math.min(2_000, Number(arg("limit") ?? 50)));

const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
if (!user) {
  console.error(`사용자를 찾을 수 없습니다: ${email}`);
  process.exit(2);
}
const row = await loadAiConfig();
if (!row.enabled) {
  console.error("AI 연결이 꺼져 있습니다. 관리자 화면에서 켜 주세요.");
  process.exit(2);
}
const config = runtimeAiConfig(row);
const graph = await loadDiscoveryGraph({ domain: arg("domain"), withSimilarity: false });
const targets = selectConceptTerms(graph.nodes, limit);
console.log(`${apply ? "저장" : "미리보기"}: 개념 용어 ${targets.length}개 (전체 ${graph.nodes.length}개 중)`);

let proposed = 0;
for (const [index, term] of targets.entries()) {
  try {
    const outcome = await curateTermRelations(config, term.id, { dryRun: !apply, proposer: { userId: user.id } });
    console.log(`[${index + 1}/${targets.length}] ${term.name}: 후보 ${outcome?.candidates ?? 0}, 판정 ${outcome?.judgments.length ?? 0}`);
    for (const judgment of outcome?.judgments ?? []) {
      if (judgment.outcome === "proposed") proposed += 1;
      const [from, to] = judgment.direction === "forward" ? [term.name, judgment.candidate.name] : [judgment.candidate.name, term.name];
      console.log(`  ${from} -${judgment.relationType}-> ${to} (${judgment.confidence}, ${judgment.outcome}) ${judgment.evidence}`);
    }
  } catch (error) {
    console.log(`[${index + 1}/${targets.length}] ${term.name}: 실패 — ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(apply ? `proposed 관계 ${proposed}개를 만들었습니다. 관계 검토 화면에서 승인해 주세요.` : "미리보기를 마쳤습니다. 저장하려면 --apply를 붙이세요.");
process.exit(0);
