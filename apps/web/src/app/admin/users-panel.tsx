"use client";

import { useMemo, useState } from "react";
import type { ManagedUser, ManagedUserRole } from "@/lib/admin/users";
import { cx } from "@/lib/ui/format";

const ROLE_LABEL: Record<ManagedUserRole, string> = { admin: "관리자", editor: "편집자" };
const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });

type BusyAction = { id: string; kind: "role" | "sessions" } | null;

export function UsersPanel({ initialUsers, viewerId }: { initialUsers: ManagedUser[]; viewerId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visibleUsers = useMemo(
    () => users.filter((user) => !normalizedQuery || `${user.name} ${user.email}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery)),
    [normalizedQuery, users],
  );
  const admins = users.filter((user) => user.role === "admin").length;
  const ssoUsers = users.filter((user) => user.authType === "sso").length;
  const activeSessions = users.reduce((sum, user) => sum + user.activeSessions, 0);

  async function changeRole(user: ManagedUser, role: ManagedUserRole) {
    if (user.role === role || busy) return;
    if (role === "editor" && !window.confirm(`${user.name || user.email} 사용자를 편집자로 변경할까요?`)) return;

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
    if (busy || user.activeSessions === 0) return;
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

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="사용자 현황">
        <StatCard label="전체 사용자" value={users.length} />
        <StatCard label="관리자" value={admins} />
        <StatCard label="SSO 계정" value={ssoUsers} />
        <StatCard label="활성 세션" value={activeSessions} />
      </section>

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

        {message && (
          <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3", message.kind === "bad" ? "note-danger" : "note-ok")}>
            {message.text}
          </p>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
                <th scope="col" className="px-4 py-3 font-medium">사용자</th>
                <th scope="col" className="px-3 py-3 font-medium">로그인 방식</th>
                <th scope="col" className="px-3 py-3 font-medium">가입일</th>
                <th scope="col" className="px-3 py-3 font-medium">활성 세션</th>
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
                          <span className="block max-w-64 truncate text-xs text-ink-3">{user.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3"><span className="chip">{user.authType === "sso" ? "SSO" : "비밀번호"}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-2">{DATE_FORMAT.format(new Date(user.createdAt))}</td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums text-ink-2">{user.activeSessions}</td>
                    <td className="px-3 py-3">
                      <label htmlFor={`role-${user.id}`} className="sr-only">{user.name || user.email} 역할</label>
                      <select
                        id={`role-${user.id}`}
                        value={user.role}
                        disabled={isSelf || roleBusy || busy !== null}
                        onChange={(event) => void changeRole(user, event.target.value as ManagedUserRole)}
                        className="field min-w-28 py-1.5 text-xs"
                        title={isSelf ? "현재 로그인한 계정의 역할은 변경할 수 없습니다." : undefined}
                      >
                        <option value="editor">편집자</option>
                        <option value="admin">관리자</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={isSelf || user.activeSessions === 0 || sessionsBusy || busy !== null}
                        onClick={() => void revokeSessions(user)}
                        className="btn-ghost btn-sm whitespace-nowrap"
                        title={isSelf ? "자신의 세션은 로그아웃으로 종료하세요." : undefined}
                      >
                        {sessionsBusy ? "종료 중…" : "세션 종료"}
                      </button>
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
