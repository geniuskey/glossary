import { processMeetingRagIndexQueue } from "../src/lib/rag/meeting-indexer";
import { processRagIndexQueue } from "../src/lib/rag/indexer";
import { processWikiRagIndexQueue } from "../src/lib/rag/wiki-indexer";
import { runDataRetention } from "../src/lib/retention";

// Number("abc")는 NaN이고 Math.max/min은 NaN을 그대로 통과시킨다. batch=NaN이면 큐를
// 하나도 집지 않고, sleep(NaN)은 0ms라 워커가 아무 일 없이 바쁘게 돈다.
function intEnv(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

const batchSize = intEnv("GLOSSARY_RAG_WORKER_BATCH", 8, 1, 32);
const idleMs = intEnv("GLOSSARY_RAG_WORKER_IDLE_MS", 2_000, 250);
const busyMs = intEnv("GLOSSARY_RAG_WORKER_BUSY_MS", 100, 50);
let stopping = false;
let nextRetentionAt = 0;

process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(): Promise<number> {
  const [terms, meetings, wiki] = await Promise.all([
    processRagIndexQueue(batchSize),
    processMeetingRagIndexQueue(batchSize),
    processWikiRagIndexQueue(batchSize),
  ]);
  return terms + meetings + wiki;
}

async function main(): Promise<void> {
  console.info(`[rag-worker] started batch=${batchSize}`);
  while (!stopping) {
    try {
      const attempted = await tick();
      if (Date.now() >= nextRetentionAt) {
        console.info("[rag-worker] running retention");
        console.info("[retention] completed", await runDataRetention());
        nextRetentionAt = Date.now() + 60 * 60_000;
      }
      await sleep(attempted > 0 ? busyMs : idleMs);
    } catch (error) {
      console.error("[rag-worker] tick failed", error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" });
      await sleep(idleMs);
    }
  }
  console.info("[rag-worker] stopping");
}

void main().catch((error) => {
  console.error("[rag-worker] fatal", error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" });
  process.exitCode = 1;
});
