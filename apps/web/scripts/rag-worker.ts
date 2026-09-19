import { processMeetingRagIndexQueue } from "../src/lib/rag/meeting-indexer";
import { processRagIndexQueue } from "../src/lib/rag/indexer";
import { processWikiRagIndexQueue } from "../src/lib/rag/wiki-indexer";
import { runDataRetention } from "../src/lib/retention";

const batchSize = Math.max(1, Math.min(32, Number(process.env.GLOSSARY_RAG_WORKER_BATCH ?? 8)));
const idleMs = Math.max(250, Number(process.env.GLOSSARY_RAG_WORKER_IDLE_MS ?? 2_000));
const busyMs = Math.max(50, Number(process.env.GLOSSARY_RAG_WORKER_BUSY_MS ?? 100));
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
