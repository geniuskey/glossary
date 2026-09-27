import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { decodeSyncBundle, encodeSyncBundle, syncBundleFilename, SYNC_BUNDLE_EXTENSION, type SyncBundle } from "../src/lib/sync/bundle";
import { buildSyncBundle, recordSyncExport, syncBundleCounts } from "../src/lib/sync/export";
import { applySyncBundle, SyncImportError, type SyncImportReport } from "../src/lib/sync/import";
import { getSyncStatus } from "../src/lib/sync/status";

// seed-terms.ts와 같은 이유로 루트 .env를 직접 읽는다. 컨테이너에서는 파일이 없고
// 환경변수가 이미 주어진다.
try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 운영·컨테이너 환경변수를 그대로 쓴다.
}

const USAGE = `usage:
  sync export [--incremental [--base <bundleId>]] [--out <dir>] [--label <name>]
  sync import <file|dir>... [--apply] [--keep-local-edits]
  sync status

export  기본은 전체 번들. --incremental은 직전(또는 --base) 내보내기 이후 바뀐 항목만 싣는다.
import  기본은 미리보기(dry run). --apply를 붙여야 반영한다. 폴더를 주면 안의 번들을
        내보낸 순서대로 적용하고, 이미 반영한 것보다 오래된 번들은 건너뛴다.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function summarize(report: SyncImportReport): string {
  const line = (name: string, t: { created: number; updated: number; deleted: number; unchanged: number }) =>
    `  ${name.padEnd(10)} +${t.created} ~${t.updated} -${t.deleted} =${t.unchanged}`;
  const out = [
    `${report.dryRun ? "[미리보기]" : "[반영]"} ${report.source.label} ${report.mode} ${report.exportedAt} (${report.bundleId})`,
    line("용어", report.counts.terms),
    line("위키", report.counts.wikiPages),
    line("관계", report.counts.relations),
    line("도메인", report.counts.domains),
    line("업무분류", report.counts.businessCategories),
    `  첨부 이미지 추가 ${report.attachmentsAdded}`,
  ];
  const { conflicts, overwritten, kept, stale } = report.issueTotals;
  if (conflicts + overwritten + kept + stale > 0) {
    out.push(`  충돌 ${conflicts} · 덮어씀 ${overwritten} · 남김 ${kept} · 누락 ${stale}`);
    for (const [kind, items] of [["충돌", report.conflicts], ["덮어씀", report.overwritten], ["남김", report.kept], ["누락", report.stale]] as const) {
      for (const item of items.slice(0, 20)) out.push(`    [${kind}] ${item.label}: ${item.reason}`);
    }
  }
  if (stale > 0) out.push("  누락이 있습니다. 보내는 쪽에서 `sync export`(전체)로 다시 내보내 적용하세요.");
  return out.join("\n");
}

async function bundleFiles(inputs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const input of inputs) {
    const info = await stat(input).catch(() => fail(`파일을 찾을 수 없습니다: ${input}`));
    if (info.isDirectory()) {
      for (const name of await readdir(input)) {
        if (name.endsWith(SYNC_BUNDLE_EXTENSION) || name.endsWith(".glossary-sync.json")) files.push(path.join(input, name));
      }
    } else {
      files.push(input);
    }
  }
  return files;
}

async function runExport(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      incremental: { type: "boolean", default: false },
      base: { type: "string" },
      out: { type: "string", default: "." },
      label: { type: "string" },
    },
  });
  const bundle = await buildSyncBundle({
    mode: values.incremental ? "incremental" : "full",
    baseBundleId: values.base ?? null,
    label: values.label,
  });
  const bytes = encodeSyncBundle(bundle);
  await mkdir(values.out!, { recursive: true });
  const file = path.join(values.out!, syncBundleFilename(bundle));
  await writeFile(file, bytes);
  await recordSyncExport(bundle, bytes.byteLength);
  const counts = Object.entries(syncBundleCounts(bundle)).map(([key, n]) => `${key}=${n}`).join(" ");
  console.log(`${file} (${(bytes.byteLength / 1024).toFixed(1)}KB) ${counts}`);
}

async function runImport(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      apply: { type: "boolean", default: false },
      "keep-local-edits": { type: "boolean", default: false },
    },
  });
  if (positionals.length === 0) fail(USAGE);
  const files = await bundleFiles(positionals);
  if (files.length === 0) fail("가져올 번들 파일이 없습니다.");

  const bundles: { file: string; bundle: SyncBundle }[] = [];
  for (const file of files) {
    try {
      bundles.push({ file, bundle: decodeSyncBundle(await readFile(file)) });
    } catch (err) {
      fail(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 변경분 번들은 순서가 의미를 가진다. 파일 이름이 아니라 번들이 기록한 시각으로 정렬한다.
  bundles.sort((a, b) => a.bundle.exportedAt.localeCompare(b.bundle.exportedAt));

  let staleTotal = 0;
  for (const { file, bundle } of bundles) {
    try {
      const report = await applySyncBundle(bundle, {
        dryRun: !values.apply,
        localEdits: values["keep-local-edits"] ? "keep" : "source",
      });
      console.log(`${path.basename(file)}\n${summarize(report)}`);
      staleTotal += report.issueTotals.stale;
    } catch (err) {
      if (err instanceof SyncImportError && err.code === "older_bundle" && bundles.length > 1) {
        console.log(`${path.basename(file)}: 이미 반영한 번들보다 오래되어 건너뜁니다.`);
        continue;
      }
      fail(`${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 미리보기는 반영하지 않으므로 다음 번들의 결과가 앞 번들 적용을 전제하지 못한다.
    if (!values.apply && bundles.length > 1) {
      console.log("미리보기는 첫 번들만 계산합니다. --apply로 순서대로 반영하세요.");
      break;
    }
  }
  if (staleTotal > 0) process.exitCode = 2;
}

async function runStatus() {
  const status = await getSyncStatus();
  console.log(`이 서버: ${status.label} (${status.instanceId})`);
  console.log("최근 내보내기:");
  for (const item of status.exports) console.log(`  ${item.createdAt} ${item.mode.padEnd(11)} ${item.id}`);
  if (status.exports.length === 0) console.log("  없음");
  console.log("가져온 출처:");
  for (const source of status.sources) {
    console.log(`  ${source.label} (${source.instanceId}) 마지막 번들 ${source.lastExportedAt}, 적용 ${source.lastImportedAt}, 추적 ${source.trackedCount}건`);
  }
  if (status.sources.length === 0) console.log("  없음");
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "export") await runExport(rest);
  else if (command === "import") await runImport(rest);
  else if (command === "status") await runStatus();
  else fail(USAGE);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
process.exit(process.exitCode ?? 0);
