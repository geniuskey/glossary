"use client";

import { useState } from "react";

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

interface DomainOption { key: string; label: string }

export function MeetingDocumentsPanel({ initialMeetings, domains }: { initialMeetings: MeetingDocument[]; domains: DomainOption[] }) {
  const [meetings, setMeetings] = useState(initialMeetings);
  const [selected, setSelected] = useState<MeetingDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [source, setSource] = useState("");
  const [team, setTeam] = useState("");
  const [domain, setDomain] = useState("");
  const [content, setContent] = useState("");

  async function refresh() {
    const response = await fetch("/api/v1/meetings?pageSize=50");
    const body = await response.json().catch(() => null) as { items?: MeetingDocument[]; error?: { message?: string } } | null;
    if (!response.ok || !body?.items) throw new Error(body?.error?.message || "회의록 목록을 불러오지 못했습니다.");
    setMeetings(body.items);
  }

  async function openMeeting(id: string) {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/meetings/${id}`);
      const body = await response.json().catch(() => null) as { meeting?: MeetingDocument; error?: { message?: string } } | null;
      if (!response.ok || !body?.meeting) throw new Error(body?.error?.message || "회의록을 불러오지 못했습니다.");
      setSelected(body.meeting);
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "회의록을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }

  async function createMeeting() {
    if (saving || !title.trim() || !content.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          meetingDate: meetingDate ? new Date(`${meetingDate}T00:00:00+09:00`).toISOString() : null,
          source,
          team,
          domain: domain ? [domain] : [],
          content,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || `회의록을 저장하지 못했습니다 (${response.status}).`);
      await refresh();
      setTitle(""); setMeetingDate(""); setSource(""); setTeam(""); setDomain(""); setContent("");
      setMessage({ kind: "ok", text: "회의록을 저장했고 RAG 색인 대기열에 넣었습니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "회의록을 저장하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  async function archiveMeeting(id: string) {
    if (!window.confirm("이 회의록을 보관 처리할까요? 원문은 남지만 챗봇 검색에서는 제외됩니다.")) return;
    try {
      const response = await fetch(`/api/v1/meetings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "보관 처리하지 못했습니다.");
      setMeetings((current) => current.filter((meeting) => meeting.id !== id));
      setSelected(null);
      setMessage({ kind: "ok", text: "회의록을 보관 처리했습니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "보관 처리하지 못했습니다." });
    }
  }

  return <div className="space-y-5">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Organization memory</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">회의록 지식</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">저장한 회의록은 원문과 revision을 보존하고, 다음 챗봇 질문에서 과거 결정·액션·리스크의 근거로 검색됩니다. 자동 저장하지 않으며, 보관하면 검색에서 제외됩니다.</p>
    </header>

    {message && <p className={message.kind === "bad" ? "note-danger" : "note-ok"} role={message.kind === "bad" ? "alert" : "status"}>{message.text}</p>}

    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">저장된 회의록</h3></div>
        <div className="max-h-[38rem] divide-y divide-line overflow-y-auto">
          {meetings.map((meeting) => <button key={meeting.id} type="button" onClick={() => void openMeeting(meeting.id)} className={`block w-full px-4 py-3 text-left hover:bg-panel-2 ${selected?.id === meeting.id ? "bg-brand-soft/50" : ""}`}>
            <p className="truncate text-sm font-medium text-ink">{meeting.title}</p>
            <p className="mt-1 text-xs text-ink-3">{meeting.meetingDate ? new Date(meeting.meetingDate).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "날짜 미지정"}{meeting.team ? ` · ${meeting.team}` : ""}{meeting.domain.length ? ` · ${meeting.domain.join(", ")}` : ""}</p>
          </button>)}
          {meetings.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-3">저장된 회의록이 없습니다.</p>}
        </div>
      </section>

      <section className="card overflow-hidden">
        {selected ? <>
          <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1"><h3 className="break-words text-base font-semibold text-ink">{selected.title}</h3><p className="mt-1 text-xs text-ink-3">리비전 {selected.revision} · {selected.source || "출처 미지정"} {selected.team ? `· ${selected.team}` : ""}</p></div>
            <button type="button" className="btn-quiet btn-sm text-danger" onClick={() => void archiveMeeting(selected.id)}>보관</button>
          </div>
          <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-ink-2">{selected.content}</pre>
        </> : <div className="grid min-h-[22rem] place-items-center p-6 text-center"><p className="text-sm text-ink-3">왼쪽에서 회의록을 선택하거나<br />새 회의록을 저장하세요.</p></div>}
      </section>
    </div>

    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">회의록 저장</h3></div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <label className="block"><span className="label">제목</span><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="예: 2026 Q3 상품 회의" /></label>
        <label className="block"><span className="label">회의 일시</span><input className="field" type="date" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} /></label>
        <label className="block"><span className="label">출처</span><input className="field" value={source} onChange={(event) => setSource(event.target.value)} maxLength={200} placeholder="예: Notion, Zoom, 용어 챗봇" /></label>
        <label className="block"><span className="label">팀</span><input className="field" value={team} onChange={(event) => setTeam(event.target.value)} maxLength={200} placeholder="예: 상품팀" /></label>
        <label className="block sm:col-span-2"><span className="label">도메인</span><select className="field" value={domain} onChange={(event) => setDomain(event.target.value)}><option value="">도메인 미지정</option>{domains.map((item) => <option key={item.key} value={item.label}>{item.label}</option>)}</select></label>
        <label className="block sm:col-span-2"><span className="label">회의록 원문</span><textarea className="field min-h-56 resize-y" value={content} onChange={(event) => setContent(event.target.value)} maxLength={200_000} placeholder="회의록, 결정 사항, 담당자, 기한, 논의 맥락을 붙여넣으세요." /></label>
      </div>
      <div className="flex items-center justify-end border-t border-line px-4 py-3"><button type="button" className="btn-primary" onClick={() => void createMeeting()} disabled={saving || !title.trim() || !content.trim()}>{saving ? "저장 중…" : "회의록 저장"}</button></div>
    </section>
    {loading && <p className="text-xs text-ink-3">회의록을 불러오는 중…</p>}
  </div>;
}
