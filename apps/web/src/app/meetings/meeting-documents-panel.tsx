"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

interface MeetingDocument {
  id: string;
  title: string;
  meetingDate: string | null;
  source: string;
  team: string;
  domain: string[];
  content?: string;
  revision: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

function externalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MeetingDocumentsPanel({ initialMeetings, confluenceUrl }: { initialMeetings: MeetingDocument[]; confluenceUrl: string | null }) {
  const [meetings] = useState(initialMeetings);
  const [selected, setSelected] = useState<MeetingDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visibleMeetings = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return meetings;
    return meetings.filter((meeting) => [meeting.title, meeting.source, meeting.team, ...meeting.domain]
      .join(" ").toLocaleLowerCase("ko-KR").includes(keyword));
  }, [meetings, query]);

  async function openMeeting(id: string) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/meetings/${id}`);
      const body = await response.json().catch(() => null) as { meeting?: MeetingDocument; error?: { message?: string } } | null;
      if (!response.ok || !body?.meeting) throw new Error(body?.error?.message || "회의 자료를 불러오지 못했습니다.");
      setSelected(body.meeting);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "회의 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const selectedSourceUrl = externalUrl(selected?.source);
  const draftHref = `/w/new?from=meeting${selectedSourceUrl ? `&sourceUrl=${encodeURIComponent(selectedSourceUrl)}` : ""}`;

  return <div className="space-y-5">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Source inbox</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">회의 지식 인박스</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">회의록 원문은 Confluence에서 작성·수정합니다. 이 화면에는 원문을 복사해 쌓지 않고, 재사용할 결정·원칙·용어를 위키와 용어집으로 승격하는 흐름만 남깁니다.</p>
    </header>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden>↗</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Confluence 원문</h3>
            <p className="mt-1 text-sm leading-6 text-ink-2">회의록의 유일한 원본입니다. 최신 내용과 수정은 항상 Confluence에서 확인하세요.</p>
            {confluenceUrl ? <a href={confluenceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-medium text-brand underline underline-offset-2">회의록 목록 열기</a> : <p className="mt-3 text-xs leading-5 text-ink-3"><code>GLOSSARY_CONFLUENCE_MEETINGS_URL</code>을 설정하면 회의록 목록 바로가기가 표시됩니다.</p>}
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ok-soft text-ok" aria-hidden>✓</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">검토된 지식만 승격</h3>
            <p className="mt-1 text-sm leading-6 text-ink-2">회의록 전체를 옮기지 말고, 반복해서 참고할 업무 맥락만 문서화하세요.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
              <Link href="/w/new?from=meeting" className="text-brand underline underline-offset-2">위키 초안 만들기</Link>
              <Link href="/new" className="text-brand underline underline-offset-2">새 용어 등록</Link>
              <Link href="/chat" className="text-brand underline underline-offset-2">회의 내용 분석</Link>
            </div>
          </div>
        </div>
      </section>
    </div>

    {message && <p className="note-danger" role="alert">{message}</p>}

    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="text-sm font-semibold text-ink">기존 분석 자료</h3><p className="mt-1 text-xs text-ink-3">이전에 앱에 저장된 자료 · 읽기 전용</p></div>
            <span className="rounded-full bg-panel-2 px-2 py-1 text-[11px] text-ink-3">{visibleMeetings.length}/{meetings.length}</span>
          </div>
          {meetings.length > 0 && <label className="mt-3 block"><span className="sr-only">분석 자료 검색</span><input className="field text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·팀·출처 검색" /></label>}
        </div>
        <div className="max-h-[38rem] divide-y divide-line overflow-y-auto">
          {visibleMeetings.map((meeting) => <button key={meeting.id} type="button" onClick={() => void openMeeting(meeting.id)} className={`block w-full px-4 py-3 text-left hover:bg-panel-2 ${selected?.id === meeting.id ? "bg-brand-soft/50" : ""}`}>
            <div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{meeting.title}</p><span className="shrink-0 rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-3">레거시</span></div>
            <p className="mt-1 text-xs text-ink-3">{meeting.meetingDate ? new Date(meeting.meetingDate).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "날짜 미지정"}{meeting.team ? ` · ${meeting.team}` : ""}{meeting.domain.length ? ` · ${meeting.domain.join(", ")}` : ""}</p>
          </button>)}
          {visibleMeetings.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">{meetings.length === 0 ? "아직 앱에 저장된 회의 자료가 없습니다." : "검색 결과가 없습니다."}</p>}
        </div>
      </section>

      <section className="card overflow-hidden">
        {selected ? <>
          <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-ink-3">읽기 전용 레거시 자료</p><h3 className="mt-1 break-words text-base font-semibold text-ink">{selected.title}</h3><p className="mt-1 text-xs text-ink-3">리비전 {selected.revision} · {selected.source || "출처 미지정"} {selected.team ? `· ${selected.team}` : ""}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {selectedSourceUrl && <a href={selectedSourceUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">원문 열기</a>}
              <Link href={draftHref} className="btn-primary btn-sm">위키 초안 만들기</Link>
            </div>
          </div>
          <div className="border-b border-line bg-warn-soft/45 px-4 py-2.5 text-xs leading-5 text-ink-2">이 자료는 이전 기능으로 저장된 사본입니다. 최신 회의 내용은 반드시 Confluence 원문을 기준으로 확인하고, 여기서는 필요한 지식만 승격하세요.</div>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-ink-2">{selected.content || "원문을 불러오지 못했습니다."}</pre>
        </> : <div className="grid min-h-[22rem] place-items-center p-6 text-center"><p className="text-sm text-ink-3">왼쪽에서 기존 분석 자료를 선택하세요.<br />새 회의록 원문은 이곳에 저장하지 않습니다.</p></div>}
      </section>
    </div>

    <div className="note-ok">
      <p className="font-medium">권장 흐름</p>
      <p className="mt-1 text-xs leading-5 text-ink-2">Confluence에서 원문 확인 → 필요한 부분을 챗봇으로 분석 → 결정·원칙은 <Link href="/w" className="link">위키</Link>, 반복되는 표현은 <Link href="/sheet" className="link">용어집</Link>에 등록 → 원문 링크를 남깁니다.</p>
    </div>
    {loading && <p className="text-xs text-ink-3">기존 자료를 불러오는 중…</p>}
  </div>;
}
