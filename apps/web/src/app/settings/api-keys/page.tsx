"use client";

import { useEffect, useState } from "react";

interface KeyRow {
  id: string; name: string; prefix: string; scopes: string[];
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
}

const ALL_SCOPES = ["read", "write", "validate"] as const;

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/keys");
    if (res.ok) setKeys((await res.json()).keys);
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
    void load();
  }

  async function revoke(id: string) {
    setRevoking(id);
    const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    setRevoking(null);
    if (res.ok) void load();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold">API 키</h1>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="용도 (예: ai-lint)"
          className="flex-1 rounded border border-slate-300 px-3 py-2" />
        {ALL_SCOPES.map((sc) => (
          <label key={sc} className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={scopes.includes(sc)}
              onChange={(e) =>
                setScopes(e.target.checked ? [...scopes, sc] : scopes.filter((v) => v !== sc))
              } />
            {sc}
          </label>
        ))}
        <button onClick={issue} disabled={!name || scopes.length === 0}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          발급
        </button>
      </div>

      {issued && (
        <div className="mb-6 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="mb-1 font-medium text-emerald-900">지금 복사하세요. 다시 볼 수 없습니다.</p>
          <code className="block break-all rounded bg-white px-2 py-1">{issued}</code>
        </div>
      )}

      <ul className="divide-y divide-slate-200">
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-3 text-sm">
            <span className="font-medium">{k.name}</span>
            <span className="text-slate-500">glk_{k.prefix}_… · {k.scopes.join(", ")}</span>
            <span className="text-slate-400">
              {k.lastUsedAt ? `최근 사용 ${k.lastUsedAt.slice(0, 10)}` : "미사용"}
            </span>
            {k.revokedAt ? (
              <span className="text-slate-400">폐기됨</span>
            ) : (
              <button onClick={() => revoke(k.id)} disabled={revoking === k.id}
                className="rounded border border-red-200 px-3 py-1 text-red-700 disabled:opacity-50">
                폐기
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
