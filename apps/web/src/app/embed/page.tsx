import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseEmbedColumns, parseEmbedOptions } from "@/lib/embed/sheet-share";
import { TERM_STATUS_LABEL, TERM_TYPE_LABEL } from "@/lib/terms/enums";
import { cellText, type ColumnKey, type TermRow } from "@/lib/terms/grid";
import { parseListParams, type RawSearchParams } from "@/lib/terms/list-params";
import { listPublishedTermRows } from "@/lib/terms/query";
import { cx } from "@/lib/ui/format";

export const metadata = { title: "공유 시트" };

const EMBED_LIMIT = 200;

export default async function EmbedPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper p-6">
        <div className="card max-w-md p-6 text-center">
          <h1 className="text-base font-semibold">Grossary 로그인이 필요합니다</h1>
          <p className="mt-2 text-sm leading-6 text-ink-2">새 창에서 로그인한 뒤 이 블록을 새로고침해 주세요. 계속 보이면 두 서비스가 같은 사이트 범위에서 운영되는지 확인하세요.</p>
          <Link href="/login" target="_blank" className="btn-primary mt-4">새 창에서 로그인</Link>
        </div>
      </main>
    );
  }

  const raw = await searchParams;
  const params = parseListParams(raw);
  const columns = parseEmbedColumns(raw.columns);
  const options = parseEmbedOptions(raw);
  const { items, total } = await listPublishedTermRows({
    q: params.q,
    termType: params.type,
    domain: params.domain,
    category: params.category,
    status: params.status,
    sort: params.sort,
    dir: params.dir,
    page: 1,
    pageSize: EMBED_LIMIT,
  });

  return (
    <main className={cx("min-h-screen bg-panel", options.border && "p-2")}>
      <div className={cx("overflow-auto", options.border && "rounded-lg border border-line")}>
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">공개 용어 {total}개 중 최대 {EMBED_LIMIT}개를 표시하는 Grossary 공유 시트</caption>
          <thead className="sticky top-0 z-10 bg-panel-2 text-ink-2">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" style={{ minWidth: Math.min(column.width, 260) }} className={cx("border-b border-grid font-semibold", options.compact ? "px-2 py-1.5" : "px-3 py-2.5")}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="even:bg-panel-2/35 hover:bg-brand-soft/40">
                {columns.map((column) => (
                  <td key={column.key} className={cx("max-w-[28rem] border-b border-grid align-top text-ink-2", options.compact ? "px-2 py-1.5" : "px-3 py-2.5", (column.key === "definitionMd" || column.key === "bodyMd") && "whitespace-pre-wrap leading-5")}>
                    <EmbedCell row={row} column={column.key} links={options.links} />
                  </td>
                ))}
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-14 text-center text-sm text-ink-3">조건에 맞는 공개 용어가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function EmbedCell({ row, column, links }: { row: TermRow; column: ColumnKey; links: boolean }) {
  let text = cellText(row, column);
  if (column === "termType") text = TERM_TYPE_LABEL[row.termType];
  if (column === "status") text = TERM_STATUS_LABEL[row.status];
  if (column === "updatedAt") text = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(row.updatedAt));

  if (links && (column === "nameEn" || column === "nameKo" || column === "slug") && text) {
    return <Link href={`/w/${row.slug}`} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:text-brand">{text}</Link>;
  }
  return text || <span aria-label="값 없음" className="text-ink-3">—</span>;
}
