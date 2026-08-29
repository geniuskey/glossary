"use client";

import { useEffect, useState } from "react";
import { formatClaimList, parseClaimList } from "@/lib/auth/sso/claims";

// api-keys-panel.tsx와 같은 이유로 상태를 갖는 이 조각만 Client Component다 —
// page.tsx는 평범한 Server Component로 남아 인증 게이트(PROTO B)를 그대로 받는다.

interface SsoView {
  enabled: boolean;
  buttonLabel: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  hasClientSecret: boolean;
  scopes: string[];
  tokenAuthMethod: string;
  baseUrl: string;
  subjectClaims: string[];
  emailClaims: string[];
  nameClaims: string[];
  groupClaims: string[];
  allowedGroups: string[];
  adminGroups: string[];
  autoCreate: boolean;
  lastClaimKeys: string[];
  lastLoginAt: string | null;
}

interface Form {
  enabled: boolean;
  buttonLabel: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  tokenAuthMethod: string;
  baseUrl: string;
  autoCreate: boolean;
  scopes: string;
  subjectClaims: string;
  emailClaims: string;
  nameClaims: string;
  groupClaims: string;
  allowedGroups: string;
  adminGroups: string;
}

function toForm(sso: SsoView): Form {
  return {
    enabled: sso.enabled,
    buttonLabel: sso.buttonLabel,
    issuer: sso.issuer,
    authorizationEndpoint: sso.authorizationEndpoint,
    tokenEndpoint: sso.tokenEndpoint,
    userinfoEndpoint: sso.userinfoEndpoint,
    clientId: sso.clientId,
    tokenAuthMethod: sso.tokenAuthMethod,
    baseUrl: sso.baseUrl,
    autoCreate: sso.autoCreate,
    scopes: formatClaimList(sso.scopes),
    subjectClaims: formatClaimList(sso.subjectClaims),
    emailClaims: formatClaimList(sso.emailClaims),
    nameClaims: formatClaimList(sso.nameClaims),
    groupClaims: formatClaimList(sso.groupClaims),
    allowedGroups: formatClaimList(sso.allowedGroups),
    adminGroups: formatClaimList(sso.adminGroups),
  };
}

export function SsoSettingsForm() {
  const [form, setForm] = useState<Form | null>(null);
  const [view, setView] = useState<SsoView | null>(null);
  const [redirectUri, setRedirectUri] = useState("");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/v1/sso");
    if (!res.ok) return;
    const body = await res.json();
    setView(body.sso);
    setForm(toForm(body.sso));
    setRedirectUri(body.redirectUri);
  }

  useEffect(() => {
    void load();
  }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function discover() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/v1/sso/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issuer: form.issuer }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "bad", text: body?.error?.message ?? "발견 문서를 읽지 못했습니다." });
      return;
    }

    const d = body.discovery;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            issuer: d.issuer || prev.issuer,
            authorizationEndpoint: d.authorizationEndpoint,
            tokenEndpoint: d.tokenEndpoint,
            userinfoEndpoint: d.userinfoEndpoint,
          }
        : prev,
    );
    // 발견 문서의 claims_supported는 "이 IdP에서 고를 수 있는 이름"이라 매핑을 정할 때 그대로 쓸모가 있다.
    setMessage({
      kind: "ok",
      text: d.claimsSupported.length
        ? `엔드포인트를 채웠습니다. 이 IdP가 알린 claim: ${d.claimsSupported.join(", ")}`
        : "엔드포인트를 채웠습니다. 저장을 눌러야 반영됩니다.",
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/v1/sso", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: form.enabled,
        buttonLabel: form.buttonLabel,
        issuer: form.issuer,
        authorizationEndpoint: form.authorizationEndpoint,
        tokenEndpoint: form.tokenEndpoint,
        userinfoEndpoint: form.userinfoEndpoint,
        clientId: form.clientId,
        // 빈 칸은 "그대로 두기"다 — 화면은 저장된 시크릿을 되받지 않는다.
        clientSecret: secret,
        scopes: parseClaimList(form.scopes),
        tokenAuthMethod: form.tokenAuthMethod,
        baseUrl: form.baseUrl,
        subjectClaims: parseClaimList(form.subjectClaims),
        emailClaims: parseClaimList(form.emailClaims),
        nameClaims: parseClaimList(form.nameClaims),
        groupClaims: parseClaimList(form.groupClaims),
        allowedGroups: parseClaimList(form.allowedGroups),
        adminGroups: parseClaimList(form.adminGroups),
        autoCreate: form.autoCreate,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "bad", text: body?.error?.message ?? "저장하지 못했습니다." });
      return;
    }

    setSecret("");
    setView(body.sso);
    setForm(toForm(body.sso));
    setRedirectUri(body.redirectUri);
    setMessage({ kind: "ok", text: "저장했습니다." });
  }

  if (!form || !view) return <p className="text-sm text-ink-3">불러오는 중...</p>;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">연결</h2>
        <p className="mt-1 text-xs text-ink-3">
          OpenID Connect(인가 코드 + PKCE)로 붙습니다. IdP에는 아래 리디렉션 URI를 등록하세요.
        </p>

        <div className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
          <span className="text-[11px] text-ink-3">리디렉션 URI</span>
          <p className="break-all font-mono text-xs text-ink">{redirectUri}</p>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          로그인 화면에 SSO 버튼 보이기
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField label="버튼 문구" value={form.buttonLabel} onChange={(v) => set("buttonLabel", v)} />

          <div className="sm:col-span-2">
            <label className="label" htmlFor="sso-issuer">
              Issuer
            </label>
            <div className="flex gap-2">
              <input
                id="sso-issuer"
                className="field font-mono text-xs"
                value={form.issuer}
                onChange={(e) => set("issuer", e.target.value)}
                placeholder="https://login.example.com/realms/company"
              />
              <button type="button" className="btn-ghost shrink-0" onClick={discover} disabled={busy || !form.issuer}>
                불러오기
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              불러오기를 누르면 /.well-known/openid-configuration에서 아래 엔드포인트를 채웁니다.
            </p>
          </div>

          <TextField
            label="인가 엔드포인트"
            mono
            value={form.authorizationEndpoint}
            onChange={(v) => set("authorizationEndpoint", v)}
          />
          <TextField label="토큰 엔드포인트" mono value={form.tokenEndpoint} onChange={(v) => set("tokenEndpoint", v)} />
          <TextField
            label="userinfo 엔드포인트 (선택)"
            mono
            value={form.userinfoEndpoint}
            onChange={(v) => set("userinfoEndpoint", v)}
            hint="그룹을 여기서만 주는 IdP가 많습니다"
          />
          <TextField label="클라이언트 ID" mono value={form.clientId} onChange={(v) => set("clientId", v)} />

          <div>
            <label className="label" htmlFor="sso-secret">
              클라이언트 시크릿
            </label>
            <input
              id="sso-secret"
              type="password"
              className="field font-mono text-xs"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={view.hasClientSecret ? "저장됨 — 바꿀 때만 입력" : "IdP에서 발급받은 값"}
            />
          </div>

          <TextField label="scope" value={form.scopes} onChange={(v) => set("scopes", v)} hint="쉼표로 구분" />

          <div>
            <label className="label" htmlFor="sso-auth-method">
              토큰 요청 인증 방식
            </label>
            <select
              id="sso-auth-method"
              className="field"
              value={form.tokenAuthMethod}
              onChange={(e) => set("tokenAuthMethod", e.target.value)}
            >
              <option value="client_secret_post">client_secret_post (본문)</option>
              <option value="client_secret_basic">client_secret_basic (헤더)</option>
            </select>
          </div>

          <TextField
            label="외부 주소 (선택)"
            mono
            value={form.baseUrl}
            onChange={(v) => set("baseUrl", v)}
            hint="프록시 뒤라 Host 헤더를 못 믿을 때만"
          />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">값 매핑</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          회사마다 같은 값을 다른 이름으로 줍니다(name / displayName / preferred_username). 후보를 쉼표로 여러 개
          적으면 <strong className="font-medium text-ink-2">앞에서부터 값이 있는 것</strong>을 씁니다. 점 경로
          (<code className="font-mono">user.profile.name</code>)와 URI 형태의 claim 이름도 그대로 씁니다.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="사용자 식별자 (sub)"
            mono
            value={form.subjectClaims}
            onChange={(v) => set("subjectClaims", v)}
            hint="계정을 다시 찾는 열쇠입니다. 바뀌지 않는 값을 고르세요"
          />
          <TextField label="이메일" mono value={form.emailClaims} onChange={(v) => set("emailClaims", v)} />
          <TextField label="이름" mono value={form.nameClaims} onChange={(v) => set("nameClaims", v)} />
          <TextField
            label="그룹"
            mono
            value={form.groupClaims}
            onChange={(v) => set("groupClaims", v)}
            hint="여기 적은 claim들의 값을 모두 합칩니다"
          />
        </div>

        {/* IdP가 실제로 무엇을 보냈는지 모른 채 이름을 맞히는 것이 이 설정에서 가장 오래 걸리는 부분이다. */}
        <div className="mt-4 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
          <span className="text-[11px] text-ink-3">
            {view.lastLoginAt
              ? `마지막 SSO 로그인(${new Date(view.lastLoginAt).toLocaleString("ko-KR")})에서 IdP가 보낸 claim 이름`
              : "아직 SSO 로그인이 없습니다. 한 번 시도하면 IdP가 보낸 claim 이름이 여기에 나옵니다."}
          </span>
          {view.lastClaimKeys.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.lastClaimKeys.map((key) => (
                <span key={key} className="chip font-mono text-[11px]">
                  {key}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">접근과 권한</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="허용 그룹"
            mono
            value={form.allowedGroups}
            onChange={(v) => set("allowedGroups", v)}
            hint="비우면 IdP로 로그인되는 사람 전원"
          />
          <TextField
            label="관리자 그룹"
            mono
            value={form.adminGroups}
            onChange={(v) => set("adminGroups", v)}
            hint="이 그룹이면 관리자로 올립니다(내리지는 않습니다)"
          />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.autoCreate} onChange={(e) => set("autoCreate", e.target.checked)} />
          처음 보는 사람의 계정을 자동으로 만들기
        </label>
      </section>

      {message && <p className={message.kind === "ok" ? "note-ok" : "note-danger"}>{message.text}</p>}

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          저장
        </button>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  mono?: boolean;
}) {
  const id = `sso-${label.replace(/[^a-zA-Z가-힣]+/g, "-")}`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={mono ? "field font-mono text-xs" : "field"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}
