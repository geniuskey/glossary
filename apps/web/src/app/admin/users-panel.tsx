"use client";

import { useMemo, useState } from "react";
import { copyText } from "@/lib/ui/copy-text";
import type { ManagedUser, ManagedUserRole } from "@/lib/admin/users";
import { planBulkRoleChange } from "@/lib/admin/bulk-roles";
import {
  AUTH_TYPE_LABEL,
  ROLE_LABEL,
  filterManagedUsers,
  hiddenSelectionCount,
  pageOf,
  roleChangeConfirmMessage,
  type UserListFilter,
} from "@/lib/admin/user-list";
import { cx } from "@/lib/ui/format";
import { AdminPanelHeader, AdminToast, type AdminMessage } from "./admin-ui";

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });

type BusyAction = { id: string; kind: "role" | "sessions" | "keys" } | { id: "bulk"; kind: "bulk-role" } | null;
type IssuedAgentKey = { id: string; name: string; token: string; scopes: string[]; ownerUserId?: string };

export function UsersPanel({ initialUsers, viewerId }: { initialUsers: ManagedUser[]; viewerId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [filter, setFilter] = useState<UserListFilter>({ query: "", role: "all", authType: "all" });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [issuedKeys, setIssuedKeys] = useState<IssuedAgentKey[]>([]);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [message, setMessage] = useState<AdminMessage>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkRole, setBulkRole] = useState<ManagedUserRole>("editor");

  const filteredUsers = useMemo(() => filterManagedUsers(users, filter), [filter, users]);
  const paged = pageOf(filteredUsers, page);
  const visibleUsers = paged.items;
  const filtering = filter.query.trim() !== "" || filter.role !== "all" || filter.authType !== "all";
  const admins = users.filter((user) => user.role === "admin").length;
  const externalUsers = users.filter((user) => user.authType === "sso").length;
  const agentUsers = users.filter((user) => user.authType === "agent").length;
  const activeSessions = users.reduce((sum, user) => sum + user.activeSessions, 0);
  // 본인은 체크박스를 주지 않는다. 자기 역할은 바꿀 수 없어 고를 이유가 없다.
  const selectableVisible = visibleUsers.filter((user) => user.id !== viewerId);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((user) => selectedIds.has(user.id));
  const someVisibleSelected = selectableVisible.some((user) => selectedIds.has(user.id));
  const selectedUsers = users.filter((user) => selectedIds.has(user.id));
  const hiddenSelected = hiddenSelectionCount(selectedIds, visibleUsers.map((user) => user.id));

  function updateFilter(patch: Partial<UserListFilter>) {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const user of selectableVisible) {
        if (checked) next.add(user.id);
        else next.delete(user.id);
      }
      return next;
    });
  }

  async function applyBulkRole() {
    if (busy || creatingAgent || selectedUsers.length === 0) return;
    const plan = planBulkRoleChange(selectedUsers, bulkRole, viewerId);
    const notes = [
      plan.unchanged > 0 ? `이미 ${ROLE_LABEL[bulkRole]}인 ${plan.unchanged}명` : null,
      plan.skippedAgents > 0 ? `관리자로 지정할 수 없는 에이전트 ${plan.skippedAgents}명` : null,
      plan.skippedSelf > 0 ? "본인" : null,
    ].filter(Boolean);
    if (plan.ids.length === 0) {
      setMessage({ kind: "bad", text: `바꿀 사용자가 없습니다${notes.length ? ` (${notes.join(", ")} 제외)` : ""}.` });
      return;
    }
    const hiddenNote = hiddenSelected > 0 ? `\n현재 목록에 보이지 않는 ${hiddenSelected}명도 함께 바뀝니다.` : "";
    const adminNote = bulkRole === "admin" ? "\n관리자는 사용자 역할, 로그인 방식, AI 연결 비밀값과 서버 동기화를 모두 바꿀 수 있습니다." : "";
    if (!window.confirm(`선택한 ${plan.ids.length}명의 역할을 ${ROLE_LABEL[bulkRole]}로 변경할까요?${hiddenNote}${adminNote}${notes.length ? `\n(${notes.join(", ")}은 제외됩니다)` : ""}`)) return;

    setBusy({ id: "bulk", kind: "bulk-role" });
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: plan.ids, role: bulkRole }),
      });
      const body = (await res.json().catch(() => null)) as { changed?: string[]; error?: { message?: string } } | null;
      if (!res.ok) {
        setMessage({ kind: "bad", text: body?.error?.message ?? `역할을 변경하지 못했습니다 (${res.status}).` });
        return;
      }
      const changed = new Set(body?.changed ?? plan.ids);
      setUsers((current) => current.map((item) => changed.has(item.id) ? { ...item, role: bulkRole } : item));
      setSelectedIds(new Set());
      setMessage({ kind: "ok", text: `${changed.size}명의 역할을 ${ROLE_LABEL[bulkRole]}로 변경했습니다.${notes.length ? ` (${notes.join(", ")} 제외)` : ""}` });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 역할을 변경하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(user: ManagedUser, role: ManagedUserRole) {
    if (user.role === role || busy || creatingAgent) return;
    if (!window.confirm(roleChangeConfirmMessage(user.name || user.email, user.role, role))) return;

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
      setAgentFormOpen(false);
      setMessage({ kind: "ok", text: `${body.user.name} 에이전트 계정을 만들었습니다. 아래 발급 키를 복사해 두세요.` });
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
    <section aria-labelledby="users-heading">
      <AdminPanelHeader
        id="users-heading"
        title="사용자"
        description="역할 변경과 세션 종료는 다음 요청부터 바로 적용됩니다."
        actions={(
          <button
            type="button"
            className={agentFormOpen ? "btn-ghost btn-sm" : "btn-primary btn-sm"}
            aria-expanded={agentFormOpen}
            aria-controls="agent-create"
            onClick={() => setAgentFormOpen((open) => !open)}
          >
            {agentFormOpen ? "에이전트 추가 닫기" : "에이전트 추가"}
          </button>
        )}
      />

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="사용자 현황">
        <StatCard label="전체 사용자" value={users.length} />
        <StatCard label="관리자" value={admins} />
        <StatCard label="외부 계정" value={externalUsers} />
        <StatCard label="에이전트 계정" value={agentUsers} />
        <StatCard label="활성 세션" value={activeSessions} />
      </dl>

      {agentFormOpen && (
        <section id="agent-create" className="card mb-6 p-4 sm:p-5" aria-labelledby="agent-create-heading">
          <h3 id="agent-create-heading" className="text-sm font-semibold text-ink">에이전트 계정 만들기</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">
            Hermes, OpenCode, Codex 같은 도구에서 사용할 API 전용 계정입니다. 이메일이나 비밀번호 로그인 없이 이름으로 구분하며, 편집자 권한으로 만들어집니다.
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
                autoFocus
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
      )}

      {issuedKeys.map((key) => (
        <section key={key.id} className="note-ok mb-3" aria-live="polite" aria-labelledby={`issued-agent-key-heading-${key.id}`}>
          <div className="flex items-start gap-2">
            <h3 id={`issued-agent-key-heading-${key.id}`} className="mr-auto font-medium">{key.name} 발급 키</h3>
            <button type="button" onClick={() => setIssuedKeys((current) => current.filter((item) => item.id !== key.id))} className="btn-quiet btn-sm -mt-1" aria-label={`${key.name} 발급 키 닫기`}>닫기</button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <code className="block min-w-0 flex-1 break-all rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm leading-relaxed text-ink">{key.token}</code>
            <button type="button" onClick={() => void copyIssuedKey(key)} className="btn-ghost btn-sm shrink-0" aria-label={`${key.name} 복사`}>
              {copiedKeyId === key.id ? "복사 완료" : "API 키 복사"}
            </button>
          </div>
          <p className="mt-2 text-xs">이 키는 지금 이 화면에서만 볼 수 있습니다. 닫거나 새로고침하면 다시 확인할 수 없으니 에이전트 설정에 붙여넣을 수 있도록 복사해 두세요.</p>
          <p className="mt-1 text-xs text-ink-2">권한: {key.scopes.join(", ")}</p>
        </section>
      ))}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor="admin-user-search" className="sr-only">사용자 검색</label>
          <input
            id="admin-user-search"
            name="userSearch"
            type="search"
            autoComplete="off"
            value={filter.query}
            onChange={(event) => updateFilter({ query: event.target.value })}
            placeholder="이름·이메일·조직 검색…"
            className="field"
          />
        </div>
        <div className="flex gap-2">
          <label htmlFor="admin-user-role-filter" className="sr-only">역할로 거르기</label>
          <select id="admin-user-role-filter" value={filter.role} onChange={(event) => updateFilter({ role: event.target.value as UserListFilter["role"] })} className="field w-auto min-w-28">
            <option value="all">모든 역할</option>
            <option value="admin">관리자</option>
            <option value="editor">편집자</option>
            <option value="viewer">뷰어</option>
          </select>
          <label htmlFor="admin-user-auth-filter" className="sr-only">로그인 방식으로 거르기</label>
          <select id="admin-user-auth-filter" value={filter.authType} onChange={(event) => updateFilter({ authType: event.target.value as UserListFilter["authType"] })} className="field w-auto min-w-32">
            <option value="all">모든 로그인 방식</option>
            <option value="password">비밀번호</option>
            <option value="sso">외부 계정</option>
            <option value="agent">에이전트 API</option>
          </select>
        </div>
        <p className="text-xs text-ink-3 sm:ml-auto" aria-live="polite">
          {filtering ? `${filteredUsers.length.toLocaleString("ko-KR")}명 일치` : `${users.length.toLocaleString("ko-KR")}명`}
        </p>
      </div>

      {selectedIds.size > 0 && (
        <div className="card mb-3 flex flex-col gap-2.5 border-brand/40 bg-brand-soft/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="region" aria-label="선택한 사용자 일괄 변경">
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{selectedIds.size}</span>명 선택됨
            {hiddenSelected > 0 && <span className="ml-1.5 text-xs text-warn">(현재 목록 밖 {hiddenSelected}명 포함)</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="bulk-role" className="text-xs text-ink-3">역할</label>
            <select
              id="bulk-role"
              value={bulkRole}
              disabled={busy !== null || creatingAgent}
              onChange={(event) => setBulkRole(event.target.value as ManagedUserRole)}
              className="field min-w-28 py-1.5 text-xs"
            >
              <option value="viewer">뷰어</option>
              <option value="editor">편집자</option>
              <option value="admin">관리자</option>
            </select>
            <button type="button" onClick={() => void applyBulkRole()} disabled={busy !== null || creatingAgent} className="btn-primary btn-sm whitespace-nowrap">
              {busy?.kind === "bulk-role" ? "변경 중…" : "일괄 변경"}
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} disabled={busy !== null} className="btn-quiet btn-sm whitespace-nowrap">
              선택 해제
            </button>
          </div>
        </div>
      )}

        <div className="card relative overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
                <th scope="col" className="w-10 py-3 pl-4 pr-0">
                  <input
                    type="checkbox"
                    aria-label="보이는 사용자 모두 선택"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                    disabled={selectableVisible.length === 0 || busy !== null}
                    onChange={(event) => toggleAllVisible(event.target.checked)}
                  />
                </th>
                <th scope="col" className="px-3 py-3 font-medium">사용자</th>
                <th scope="col" className="px-3 py-3 font-medium">조직</th>
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
                  <tr key={user.id} className={cx("hover:bg-panel-2/55", selectedIds.has(user.id) && "bg-brand-soft/40")}>
                    <td className="w-10 py-3 pl-4 pr-0">
                      {!isSelf && (
                        <input
                          type="checkbox"
                          aria-label={`${user.name || user.email} 선택`}
                          checked={selectedIds.has(user.id)}
                          disabled={busy !== null}
                          onChange={(event) => toggleSelected(user.id, event.target.checked)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3">
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
                    <td className="px-3 py-3 text-xs text-ink-2">
                      {user.organization
                        ? <span className="block max-w-48 truncate" title={user.organization}>{user.organization}</span>
                        : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-3"><span className="chip">{AUTH_TYPE_LABEL[user.authType]}</span></td>
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
              <button type="button" onClick={() => updateFilter({ query: "", role: "all", authType: "all" })} className="btn-quiet btn-sm mt-2">조건 지우기</button>
            </div>
          )}
        </div>

      {paged.pages > 1 && (
        <nav className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-3" aria-label="사용자 목록 페이지">
          <button type="button" className="btn-ghost btn-sm" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>이전</button>
          <span className="tabular-nums" aria-current="page">{paged.page} / {paged.pages}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>다음</button>
        </nav>
      )}

      <AdminToast message={message} onClose={() => setMessage(null)} />
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-4 py-3">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-ink">{value.toLocaleString("ko-KR")}</dd>
    </div>
  );
}
