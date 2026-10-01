"use client";

import { useMemo, useState } from "react";
import { copyText } from "@/lib/ui/copy-text";
import type { ManagedUser, ManagedUserRole } from "@/lib/admin/users";
import { cx } from "@/lib/ui/format";

const ROLE_LABEL: Record<ManagedUserRole, string> = { admin: "관리자", editor: "편집자", viewer: "뷰어" };
const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });

type BusyAction = { id: string; kind: "role" | "sessions" | "keys" } | null;
type IssuedAgentKey = { id: string; name: string; token: string; scopes: string[]; ownerUserId?: string };

export function UsersPanel({ initialUsers, viewerId }: { initialUsers: ManagedUser[]; viewerId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [agentName, setAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [issuedKeys, setIssuedKeys] = useState<IssuedAgentKey[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visibleUsers = useMemo(
    () => users.filter((user) => !normalizedQuery || `${user.name} ${user.email}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery)),
    [normalizedQuery, users],
  );
  const admins = users.filter((user) => user.role === "admin").length;
  const externalUsers = users.filter((user) => user.authType === "sso").length;
  const agentUsers = users.filter((user) => user.authType === "agent").length;
  const activeSessions = users.reduce((sum, user) => sum + user.activeSessions, 0);

  async function changeRole(user: ManagedUser, role: ManagedUserRole) {
    if (user.role === role || busy || creatingAgent) return;
    if ((role === "editor" || role === "viewer") && !window.confirm(`${user.name || user.email} 사용자를 ${ROLE_LABEL[role]}로 변경할까요?`)) return;

    setBusy({ id: user.id, kind: "role" });
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `역할을 변경하지 못했습니다 (${res.status}).` });
        return;
      }
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role } : item));
      setMessage({ kind: "ok", text: `${user.name || user.email} 사용자의 역할을 ${ROLE_LABEL[role]}로 변경했습니다.` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 역할을 변경하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function revokeSessions(user: ManagedUser) {
    if (busy || creatingAgent || user.activeSessions === 0) return;
    if (!window.confirm(`${user.name || user.email} 사용자의 모든 로그인 세션을 종료할까요?`)) return;

    setBusy({ id: user.id, kind: "sessions" });
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}/sessions`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as
        | { revoked?: number; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `세션을 종료하지 못했습니다 (${res.status}).` });
        return;
      }
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, activeSessions: 0 } : item));
      setMessage({ kind: "ok", text: `${user.name || user.email} 사용자의 로그인 세션 ${body?.revoked ?? 0}개를 종료했습니다.` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 로그인 세션을 종료하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function createAgent() {
    if (creatingAgent || busy || !agentName.trim()) return;
    setCreatingAgent(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: agentName }),
      });
      const body = (await res.json().catch(() => null)) as
        | { user?: ManagedUser; key?: IssuedAgentKey; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.user || !body.key) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `에이전트 계정을 만들지 못했습니다 (${res.status}).` });
        return;
      }

      setUsers((current) => [...current, body.user!].sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.email.localeCompare(b.email)));
      setIssuedKeys((current) => [{ ...body.key!, ownerUserId: body.user!.id }, ...current]);
      setCopiedKeyId(null);
      setAgentName("");
      setMessage({ kind: "ok", text: `${body.user.name} 에이전트 계정을 만들었습니다.` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 에이전트 계정을 만들지 못했습니다." });
    } finally {
      setCreatingAgent(false);
    }
  }

  async function copyIssuedKey(key: IssuedAgentKey) {
    const success = await copyText(key.token);
    setCopiedKeyId(success ? key.id : null);
    setMessage(success ? null : { kind: "bad", text: "클립보드에 복사하지 못했습니다. 아래 키를 직접 선택해 복사하세요." });
  }

  async function manageKeys(user: ManagedUser, rotate: boolean) {
    if (busy || creatingAgent) return;
    if (!window.confirm(rotate ? `${user.name}의 기존 API 키를 모두 폐기하고 새 키를 발급할까요?` : `${user.name}의 API 키를 모두 폐기할까요?`)) return;
    setBusy({ id: user.id, kind: "keys" });
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/users/${user.id}/keys`, { method: rotate ? "POST" : "DELETE" });
      const body = await response.json().catch(() => null) as { key?: IssuedAgentKey | null; error?: { message?: string } } | null;
      if (!response.ok || (rotate && !body?.key)) throw new Error(body?.error?.message ?? "API 키를 변경하지 못했습니다.");
      const key = body?.key;
      setIssuedKeys((current) => [...(key ? [{ ...key, ownerUserId: user.id }] : []), ...current.filter((item) => item.ownerUserId !== user.id)]);
      setCopiedKeyId(null);
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, activeApiKeys: rotate ? 1 : 0 } : item));
      setMessage({ kind: "ok", text: rotate ? `${user.name}의 기존 키를 폐기하고 새 키를 발급했습니다.` : `${user.name}의 API 키를 모두 폐기했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "API 키를 변경하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="사용자 현황">
        <StatCard label="전체 사용자" value={users.length} />
        <StatCard label="관리자" value={admins} />
        <StatCard label="외부 계정" value={externalUsers} />
        <StatCard label="에이전트 계정" value={agentUsers} />
        <StatCard label="활성 세션" value={activeSessions} />
      </section>

      <section className="card mt-8 p-4 sm:p-5" aria-labelledby="agent-create-heading">
        <h2 id="agent-create-heading" className="text-base font-semibold text-ink text-balance">에이전트 계정 만들기</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">
          Hermes, OpenCode, Codex 같은 도구에서 사용할 API 전용 계정입니다. 이메일이나 비밀번호 로그인 없이 이름으로 구분합니다.
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="admin-agent-name" className="sr-only">에이전트 이름</label>
            <input
              id="admin-agent-name"
              name="agentName"
              value={agentName}
              maxLength={100}
              autoComplete="off"
              onChange={(event) => setAgentName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createAgent(); } }}
              placeholder="예: Codex, Hermes"
              className="field"
            />
          </div>
          <button type="button" onClick={() => void createAgent()} disabled={creatingAgent || busy !== null || !agentName.trim()} className="btn-primary whitespace-nowrap">
            {creatingAgent ? "만드는 중…" : "편집자 계정 만들고 키 발급"}
          </button>
        </div>
      </section>

      {message && (
        <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mt-3", message.kind === "bad" ? "note-danger" : "note-ok")}>
          {message.text}
        </p>
      )}

      {issuedKeys.map((key, index) => (
        <section key={key.id} className="note-ok mt-3" aria-live="polite" aria-labelledby={`issued-agent-key-heading-${key.id}`}>
          <h3 id={`issued-agent-key-heading-${key.id}`} className="font-medium">{key.name} 발급 키</h3>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <code className="block min-w-0 flex-1 break-all rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm leading-relaxed text-ink">{key.token}</code>
            <button type="button" onClick={() => void copyIssuedKey(key)} className="btn-ghost btn-sm shrink-0" aria-label={`${key.name} 복사`}>
              {copiedKeyId === key.id ? "복사 완료" : "API 키 복사"}
            </button>
          </div>
          {index === 0 && <p className="mt-2 text-xs">발급 키는 이번 화면에서만 확인할 수 있습니다. 에이전트 설정에 붙여넣을 수 있도록 복사해 보관하세요.</p>}
          <p className="mt-1 text-xs text-ink-2">권한: {key.scopes.join(", ")}</p>
        </section>
      ))}

      <section className="mt-8" aria-labelledby="users-heading">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="users-heading" className="text-base font-semibold text-ink text-balance">사용자 관리</h2>
            <p className="mt-1 text-xs text-ink-3">역할 변경은 다음 요청부터 즉시 적용됩니다.</p>
          </div>
          <div className="w-full sm:w-72">
            <label htmlFor="admin-user-search" className="sr-only">사용자 검색</label>
            <input
              id="admin-user-search"
              name="userSearch"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름 또는 이메일 검색…"
              className="field"
            />
          </div>
        </div>

        <div className="card relative overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
                <th scope="col" className="px-4 py-3 font-medium">사용자</th>
                <th scope="col" className="px-3 py-3 font-medium">로그인 방식</th>
                <th scope="col" className="px-3 py-3 font-medium">가입일</th>
                <th scope="col" className="px-3 py-3 font-medium">활성 세션 / 키</th>
                <th scope="col" className="px-3 py-3 font-medium">역할</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visibleUsers.map((user) => {
                const isSelf = user.id === viewerId;
                const roleBusy = busy?.id === user.id && busy.kind === "role";
                const sessionsBusy = busy?.id === user.id && busy.kind === "sessions";
                return (
                  <tr key={user.id} className="hover:bg-panel-2/55">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">
                          {(user.name || user.email).slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block max-w-64 truncate font-medium text-ink">
                            {user.name || "이름 없음"}{isSelf && <span className="ml-1.5 text-xs font-normal text-brand">나</span>}
                          </span>
                          <span className="block max-w-64 truncate text-xs text-ink-3">{user.authType === "agent" ? "API 전용 · 이메일 없음" : user.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className="chip">{user.authType === "sso" ? "외부 계정" : user.authType === "agent" ? "에이전트 API" : "비밀번호"}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-2">{DATE_FORMAT.format(new Date(user.createdAt))}</td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums text-ink-2">{user.authType === "agent" ? `키 ${user.activeApiKeys ?? 0}개` : user.activeSessions}</td>
                    <td className="px-3 py-3">
                      <label htmlFor={`role-${user.id}`} className="sr-only">{user.name || user.email} 역할</label>
                      <select
                        id={`role-${user.id}`}
                        value={user.role}
                        disabled={isSelf || roleBusy || busy !== null || creatingAgent}
                        onChange={(event) => void changeRole(user, event.target.value as ManagedUserRole)}
                        className="field min-w-28 py-1.5 text-xs"
                        title={isSelf ? "현재 로그인한 계정의 역할은 변경할 수 없습니다." : undefined}
                      >
                        <option value="viewer">뷰어</option>
                        <option value="editor">편집자</option>
                        <option value="admin" disabled={user.authType === "agent"}>관리자</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {user.authType === "agent" ? (
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled={busy !== null || creatingAgent} onClick={() => void manageKeys(user, true)} className="btn-ghost btn-sm whitespace-nowrap">키 교체</button>
                          <button type="button" disabled={busy !== null || creatingAgent || !user.activeApiKeys} onClick={() => void manageKeys(user, false)} className="btn-ghost btn-sm whitespace-nowrap">키 폐기</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isSelf || user.activeSessions === 0 || sessionsBusy || busy !== null || creatingAgent}
                          onClick={() => void revokeSessions(user)}
                          className="btn-ghost btn-sm whitespace-nowrap"
                          title={isSelf ? "자신의 세션은 로그아웃으로 종료하세요." : undefined}
                        >
                          {sessionsBusy ? "종료 중…" : "세션 종료"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visibleUsers.length === 0 && (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-ink-2">검색 조건과 맞는 사용자가 없습니다.</p>
              <button type="button" onClick={() => setQuery("")} className="btn-quiet btn-sm mt-2">검색 지우기</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-4 py-4">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-ink">{value.toLocaleString("ko-KR")}</p>
    </div>
  );
}
