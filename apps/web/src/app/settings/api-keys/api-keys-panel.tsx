"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/ui/format";

interface KeyRow {
  id: string; name: string; prefix: string; scopes: string[];
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}

const ALL_SCOPES = ["read", "write", "validate"] as const;

// scope 값은 API 요청 본문에 그대로 실리는 문자열이라 화면에서도 원문을 그대로
// 두고(그래서 font-mono), 무엇을 허용하는지는 한국어를 옆에 붙여 설명한다.
const SCOPE_HINT: Record<(typeof ALL_SCOPES)[number], string> = {
  read: "조회",
  write: "편집",
  validate: "검사",
};

// 화면 전체가 아니라 상태를 갖는 이 조각만 Client Component다(logout-button.tsx와
// 같은 이유) — 셸과 헤더는 서버에 남아 클라이언트 번들에 실리지 않고, 그 덕에
// page.tsx가 getCurrentUser로 인증을 걸 수 있어 PROTO B 허용목록에서 빠졌다.
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // 빈 상태 문구는 첫 응답 전에는 띄우지 않는다 — 키가 있는데도 "아직 없습니다"가
  // 한 프레임 스쳐 지나가면 화면이 거짓말을 하는 셈이다.
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/keys");
    if (res.ok) setKeys((await res.json()).keys);
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function issue() {
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    if (!res.ok) return;

    setIssued((await res.json()).token);
    setName("");
    setCopied(false);
    void load();
  }

  async function revoke(id: string) {
    setRevoking(id);
    const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    setRevoking(null);
    if (res.ok) void load();
  }

  // 평문 키는 이 화면에 딱 한 번 뜨고 사라진다 — 손으로 43자를 옮겨 적게 두면
  // 오타로 실패한다. 클립보드 권한이 없는 브라우저에서는 아래 평문을 직접
  // 선택해 복사할 수 있으므로 실패해도 조용히 버튼 라벨만 그대로 둔다.
  async function copyIssued() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section className="card p-4 sm:p-5">
        <h2 className="label">새 키 발급</h2>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="용도 (예: ai-lint)"
            className="field sm:flex-1"
          />
          <button onClick={issue} disabled={!name || scopes.length === 0} className="btn-primary shrink-0">
            발급
          </button>
        </div>

        {/* 체크박스는 sr-only로 숨기고 라벨 자체를 칩으로 만든다 — 켜짐/꺼짐이
            체크 표시보다 색으로 먼저 읽히고, 클릭 과녁도 칩 전체로 넓어진다.
            키보드 초점은 focus-within으로 칩에 그대로 드러난다. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-3">권한</span>
          {ALL_SCOPES.map((sc) => {
            const on = scopes.includes(sc);
            return (
              <label
                key={sc}
                className={cx(
                  "chip cursor-pointer focus-within:ring-2 focus-within:ring-brand/25",
                  on && "chip-on",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, sc] : scopes.filter((v) => v !== sc))
                  }
                  className="sr-only"
                />
                <span className="font-mono">{sc}</span>
                <span className="opacity-70">{SCOPE_HINT[sc]}</span>
              </label>
            );
          })}
        </div>
      </section>

      {issued && (
        <div className="note-ok mt-4 animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">키가 발급되었습니다</p>
            <button onClick={copyIssued} className="btn-ghost btn-sm">
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
          <code className="mt-2 block break-all rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[15px] leading-relaxed text-ink">
            {issued}
          </code>
          <p className="mt-2 text-xs font-medium">
            이 값은 다시 볼 수 없습니다. 지금 복사해 안전한 곳에 보관하세요.
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="label">발급된 키</h2>

        {keys.length > 0 ? (
          <ul className="card divide-y divide-line overflow-hidden">
            {keys.map((k) => {
              const revoked = k.revokedAt !== null;
              return (
                <li
                  key={k.id}
                  className={cx(
                    "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
                    revoked && "opacity-55",
                  )}
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium text-ink">{k.name}</p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {/* 평문은 사라졌고 남는 식별자는 접두사뿐이다 — 어느 키인지
                          대조하는 값이므로 등폭으로 둔다. */}
                      <span className="font-mono">glk_{k.prefix}_…</span>
                      <span className="mx-1.5">·</span>
                      발급 {k.createdAt.slice(0, 10)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {k.scopes.map((sc) => (
                      <span key={sc} className="chip font-mono">
                        {sc}
                      </span>
                    ))}
                  </div>

                  <span className="shrink-0 text-xs text-ink-3">
                    {k.lastUsedAt ? `최근 사용 ${k.lastUsedAt.slice(0, 10)}` : "미사용"}
                  </span>

                  {revoked ? (
                    <span className="shrink-0 text-xs font-medium text-ink-3">폐기됨</span>
                  ) : (
                    <button
                      onClick={() => revoke(k.id)}
                      disabled={revoking === k.id}
                      className="btn-danger btn-sm shrink-0"
                    >
                      {revoking === k.id ? "폐기 중" : "폐기"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : loaded ? (
          <div className="card px-4 py-10 text-center">
            <p className="text-sm text-ink-2">아직 발급된 키가 없습니다.</p>
            <p className="mt-1 text-xs text-ink-3">
              위에서 용도와 권한을 정해 첫 키를 발급하면 여기에 쌓입니다.
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
