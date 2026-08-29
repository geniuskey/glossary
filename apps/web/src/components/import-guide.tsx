import { TERM_STATUS_LABEL, TERM_STATUSES, TERM_TYPE_LABEL, TERM_TYPES } from "@/lib/terms/enums";
import { IMPORT_COLUMNS, IMPORT_RULES, SAMPLE_ROWS, TEMPLATE_HREF, type ImportColumn } from "@/lib/import/format";
import { cx } from "@/lib/ui/format";

/**
 * 샘플 파일 내려받기. Link가 아니라 <a>다 — 화면 전이가 아니라 파일 응답이라
 * 프리페치할 RSC 페이로드가 없다.
 */
export function TemplateDownloadLink({ className }: { className?: string }) {
  return (
    <a href={TEMPLATE_HREF} download className={cx("btn-ghost btn-sm gap-1.5", className)}>
      <IconDownload />
      샘플 xlsx 내려받기
    </a>
  );
}

export function ImportGuide() {
  return (
    <section className="max-w-3xl space-y-5 border-t border-line pt-7">
      <div>
        <h2 className="text-base font-semibold tracking-tight">파일은 이렇게 만듭니다</h2>
        <p className="mt-1.5 text-sm text-ink-2">
          쓰던 엑셀을 그대로 올려도 됩니다. 아래 이름 중 하나와 맞는 열만 읽고, 나머지는 건드리지 않습니다.
        </p>
      </div>

      <ul className="space-y-1.5 text-sm text-ink-2">
        {IMPORT_RULES.map((rule) => (
          <li key={rule} className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{rule}</span>
          </li>
        ))}
      </ul>

      <SamplePreview />
      <ColumnTable />
      <div className="grid gap-4 sm:grid-cols-2">
        <ValueList
          title="종류"
          hint="비거나 모르는 값이면 일반 용어"
          items={TERM_TYPES.map((t) => ({ value: t, label: TERM_TYPE_LABEL[t] }))}
        />
        <ValueList
          title="상태"
          hint="비거나 모르는 값이면 사용"
          items={TERM_STATUSES.map((s) => ({ value: s, label: TERM_STATUS_LABEL[s] }))}
        />
      </div>
    </section>
  );
}

/**
 * 샘플 파일을 엑셀 화면처럼 그린다 — 행 번호와 1행 머리글까지 같이 보여줘야
 * "1행이 열 이름"이라는 규칙이 글이 아니라 그림으로 전달된다. 내용은
 * SAMPLE_ROWS 하나에서 오므로 내려받은 파일과 절대 어긋나지 않는다.
 */
function SamplePreview() {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-medium text-ink">샘플 미리보기</h3>
        <p className="text-xs text-ink-3">내려받는 파일과 같은 내용입니다</p>
        <TemplateDownloadLink className="ml-auto" />
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <RowNumber n={1} head />
              {IMPORT_COLUMNS.map((c) => (
                <th
                  key={c.field}
                  className="whitespace-nowrap border-b border-r border-grid bg-panel-2 px-2.5 py-1.5 text-left font-medium text-ink"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SAMPLE_ROWS.map((row, i) => (
              <tr key={row.nameEn || row.nameKo}>
                <RowNumber n={i + 2} />
                {IMPORT_COLUMNS.map((c) => (
                  <td
                    key={c.field}
                    className="whitespace-nowrap border-b border-r border-grid px-2.5 py-1.5 text-ink-2"
                  >
                    {row[c.field] || <span className="text-ink-3/60">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 엑셀의 왼쪽 행 번호 칸. 스크롤해도 어느 행인지 보이도록 붙여 둔다. */
function RowNumber({ n, head = false }: { n: number; head?: boolean }) {
  const className = cx(
    "sticky left-0 z-10 w-9 border-b border-r border-grid bg-panel-2 px-2 py-1.5 text-right",
    "font-mono text-[10px] font-normal tabular-nums text-ink-3",
  );
  return head ? <th className={className}>{n}</th> : <td className={className}>{n}</td>;
}

function ColumnTable() {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-medium text-ink">인식하는 열 이름</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <Th className="w-32">열 이름</Th>
              <Th className="w-56">이렇게 적어도 됩니다</Th>
              <Th>내용</Th>
            </tr>
          </thead>
          <tbody>
            {IMPORT_COLUMNS.map((c) => (
              <tr key={c.field}>
                <Td>
                  <ColumnName column={c} />
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {c.otherHeaders.map((h) => (
                      <span key={h} className="chip font-mono text-[11px]">
                        {h}
                      </span>
                    ))}
                  </span>
                </Td>
                <Td className="text-ink-2">{c.hint}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnName({ column }: { column: ImportColumn }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-ink">{column.header}</span>
      {column.requirement === "either-name" && (
        <span className="chip border-warn/40 text-warn">둘 중 하나</span>
      )}
    </span>
  );
}

function ValueList({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.value} className="flex items-baseline gap-2 text-sm">
            <code className="font-mono text-xs text-brand">{item.value}</code>
            <span className="text-ink-2">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Th({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th
      className={cx(
        "border-b border-grid bg-panel-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide text-ink-2",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <td className={cx("border-b border-grid px-3 py-2 align-top text-ink", className)}>{children}</td>;
}

function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
