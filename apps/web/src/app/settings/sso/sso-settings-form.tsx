"use client";

import { useEffect, useState } from "react";
import { formatClaimList, parseClaimList } from "@/lib/auth/sso/claims";

// api-keys-panel.tsx와 같은 이유로 상태를 갖는 이 조각만 Client Component다 —
// page.tsx는 평범한 Server Component로 남아 인증 게이트(PROTO B)를 그대로 받는다.

interface SsoView {
  enabled: boolean;
  protocol: "oidc" | "oauth2";
  buttonLabel: string;
  issuer: string;
  jwksUri: string;
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
  protocol: "oidc" | "oauth2";
  buttonLabel: string;
  issuer: string;
  jwksUri: string;
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

interface ProxyHeaderCheck {
  authMode: "local" | "oidc" | "oauth2" | "oauth2-proxy";
  trusted: boolean;
  detected: boolean;
  headerNames: { preferredUsername: string; email: string; groups: string };
  presentHeaders: string[];
  missingHeaders: string[];
  identity: { email: string; name: string; groups: string[]; organization: string | null } | null;
}

function toForm(sso: SsoView): Form {
  return {
    enabled: sso.enabled,
    protocol: sso.protocol,
    buttonLabel: sso.buttonLabel,
    issuer: sso.issuer,
    jwksUri: sso.jwksUri,
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [proxyCheck, setProxyCheck] = useState<ProxyHeaderCheck | null>(null);
  const [checkingProxy, setCheckingProxy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/v1/sso");
      if (!res.ok) {
        setLoadError(`SSO 설정을 불러오지 못했습니다 (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { sso: SsoView; redirectUri: string };
      setView(body.sso);
      setForm(toForm(body.sso));
      setRedirectUri(body.redirectUri);
      setLoadError(null);
    } catch {
      setLoadError("네트워크 오류로 SSO 설정을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function selectProtocol(protocol: Form["protocol"]) {
    setForm((prev) => {
      if (!prev) return prev;
      const scopes = parseClaimList(prev.scopes).filter((scope) => scope !== "openid");
      return {
        ...prev,
        protocol,
        scopes: formatClaimList(protocol === "oidc" ? ["openid", ...scopes] : scopes),
      };
    });
  }

  async function discover() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/sso/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issuer: form.issuer, protocol: form.protocol }),
      });
      const body = await res.json().catch(() => null);
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
              jwksUri: d.jwksUri,
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
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 발견 문서를 읽지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/sso", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: form.enabled,
          protocol: form.protocol,
          buttonLabel: form.buttonLabel,
          issuer: form.issuer,
          jwksUri: form.jwksUri,
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
      if (!res.ok) {
        setMessage({ kind: "bad", text: body?.error?.message ?? "저장하지 못했습니다." });
        return;
      }

      setSecret("");
      setView(body.sso);
      setForm(toForm(body.sso));
      setRedirectUri(body.redirectUri);
      setMessage({ kind: "ok", text: "저장했습니다." });
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function checkProxyHeaders() {
    setCheckingProxy(true);
    setProxyCheck(null);
    try {
      const res = await fetch("/api/v1/sso/proxy-check", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ kind: "bad", text: body?.error?.message ?? "프록시 헤더를 확인하지 못했습니다." });
        return;
      }
      setProxyCheck(body.proxyHeaders);
      setMessage(null);
    } catch {
      setMessage({ kind: "bad", text: "네트워크 오류로 프록시 헤더를 확인하지 못했습니다." });
    } finally {
      setCheckingProxy(false);
    }
  }

  if (!form || !view) {
    return (
      <p role={loadError ? "alert" : undefined} className={loadError ? "note-danger" : "text-sm text-ink-3"}>
        {loadError ?? "불러오는 중…"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">연결</h2>
        <p className="mt-1 text-xs text-ink-3">
          인증 서버에는 아래 리디렉션 URI를 등록하세요. 두 방식 모두 인가 코드 + PKCE를 사용합니다.
        </p>

        <div className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
          <span className="text-[11px] text-ink-3">리디렉션 URI</span>
          <p className="break-all font-mono text-xs text-ink">{redirectUri}</p>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          로그인 화면에 SSO 버튼 보이기
        </label>

        <fieldset className="mt-4">
          <legend className="label">로그인 방식</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <ProtocolOption
              value="oidc"
              checked={form.protocol === "oidc"}
              title="OpenID Connect (OIDC)"
              description="ID 토큰의 JWKS 서명·Issuer·Audience·Nonce를 검증합니다. 가능하면 이 방식을 권장합니다."
              onChange={selectProtocol}
            />
            <ProtocolOption
              value="oauth2"
              checked={form.protocol === "oauth2"}
              title="OAuth 2.0"
              description="Access Token으로 사용자 정보 API를 호출합니다. OIDC를 제공하지 않는 사내 서버에 사용합니다."
              onChange={selectProtocol}
            />
          </div>
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField label="버튼 문구" value={form.buttonLabel} onChange={(v) => set("buttonLabel", v)} />

          <div className="sm:col-span-2">
            <label className="label" htmlFor="sso-issuer">
              {form.protocol === "oidc" ? "OIDC Issuer" : "OAuth 인증 서버 URL"}
            </label>
            <div className="flex gap-2">
              <input
                id="sso-issuer"
                name="issuer"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                className="field font-mono text-xs"
                value={form.issuer}
                onChange={(e) => set("issuer", e.target.value)}
                placeholder="https://login.example.com/realms/company…"
              />
              <button type="button" className="btn-ghost shrink-0" onClick={discover} disabled={busy || !form.issuer}>
                메타데이터 불러오기
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              {form.protocol === "oidc"
                ? "/.well-known/openid-configuration에서 엔드포인트와 JWKS URI를 채웁니다."
                : "/.well-known/oauth-authorization-server에서 지원하는 엔드포인트를 채웁니다."}
            </p>
          </div>

          {form.protocol === "oidc" && (
            <TextField label="JWKS URI" type="url" mono value={form.jwksUri} onChange={(v) => set("jwksUri", v)} hint="ID 토큰 서명 키를 읽는 주소" />
          )}

          <TextField
            label="인가 엔드포인트"
            type="url"
            mono
            value={form.authorizationEndpoint}
            onChange={(v) => set("authorizationEndpoint", v)}
          />
          <TextField label="토큰 엔드포인트" type="url" mono value={form.tokenEndpoint} onChange={(v) => set("tokenEndpoint", v)} />
          <TextField
            label={form.protocol === "oidc" ? "userinfo 엔드포인트 (선택)" : "사용자 정보 엔드포인트"}
            type="url"
            mono
            value={form.userinfoEndpoint}
            onChange={(v) => set("userinfoEndpoint", v)}
            hint={form.protocol === "oidc" ? "설정하면 ID 토큰 claim과 합칩니다" : "OAuth 2.0 로그인에는 반드시 필요합니다"}
          />
          <TextField label="클라이언트 ID" mono value={form.clientId} onChange={(v) => set("clientId", v)} />

          <div>
            <label className="label" htmlFor="sso-secret">
              클라이언트 시크릿
            </label>
            <input
              id="sso-secret"
              name="clientSecret"
              type="password"
              autoComplete="new-password"
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
            type="url"
            mono
            value={form.baseUrl}
            onChange={(v) => set("baseUrl", v)}
            hint="프록시 뒤라 Host 헤더를 못 믿을 때만"
          />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink">oauth2-proxy 헤더</h2>
            <p className="mt-1 text-xs leading-5 text-ink-3">
              관리자의 현재 요청에 실제로 도착한 이름·이메일·그룹 헤더를 검사합니다. IdP에 직접 연결하지 않으므로
              인가 서버가 닿지 않아도 프록시 헤더 경로는 따로 확인할 수 있습니다.
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0" onClick={checkProxyHeaders} disabled={checkingProxy}>
            {checkingProxy ? "확인 중…" : "연결 확인"}
          </button>
        </div>

        {proxyCheck && (
          <div aria-live="polite" className={`mt-4 ${proxyCheck.detected ? "note-ok" : "note-warn"}`}>
            {proxyCheck.identity ? (
              <p className="font-medium">
                프록시 헤더 확인됨 · {proxyCheck.identity.name}
                {proxyCheck.identity.organization ? ` (${proxyCheck.identity.organization})` : ""}
              </p>
            ) : (
              <p className="font-medium">
                {proxyCheck.presentHeaders.length > 0 && !proxyCheck.trusted
                  ? "헤더는 도착했지만 신뢰 설정이 꺼져 있습니다."
                  : `인증에 필요한 헤더를 확인하지 못했습니다${proxyCheck.missingHeaders.length ? `: ${proxyCheck.missingHeaders.join(", ")}` : "."}`}
              </p>
            )}
            <p className="mt-1 text-xs">
              AUTH_MODE={proxyCheck.authMode} · {proxyCheck.trusted ? "헤더 신뢰 사용" : "헤더 신뢰 안 함"}
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-2 text-xs text-ink-2 sm:grid-cols-3">
          <HeaderName label="닉네임" value={proxyCheck?.headerNames.preferredUsername ?? "X-Forwarded-Preferred-Username"} />
          <HeaderName label="사용자 식별·이메일" value={proxyCheck?.headerNames.email ?? "X-Forwarded-Email"} />
          <HeaderName label="그룹·조직" value={proxyCheck?.headerNames.groups ?? "X-Forwarded-Groups"} />
        </div>

        <p className="note-warn mt-4 text-xs leading-5">
          앱 포트를 외부에 직접 공개하지 말고, nginx가 클라이언트의 동일한 X-Forwarded-* 헤더를 제거한 뒤
          oauth2-proxy가 확인한 값으로 덮어쓰게 구성하세요. 직접 접속이 가능하면 헤더를 위조해 다른 사용자를 사칭할 수 있습니다.
        </p>
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

      {message && (
        <p role={message.kind === "bad" ? "alert" : "status"} className={message.kind === "ok" ? "note-ok" : "note-danger"}>
          {message.text}
        </p>
      )}

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? "저장 중…" : "SSO 설정 저장"}
        </button>
      </div>
    </div>
  );
}

function HeaderName({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <span className="block text-[10px] text-ink-3">{label}</span>
      <code className="mt-0.5 block break-all font-mono text-[11px] text-ink" translate="no">{value}</code>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  mono = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  mono?: boolean;
  type?: "text" | "url";
}) {
  const id = `sso-${label.replace(/[^a-zA-Z가-힣]+/g, "-")}`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={type === "url" ? "url" : undefined}
        autoComplete="off"
        spellCheck={!mono}
        className={mono ? "field font-mono text-xs" : "field"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

function ProtocolOption({
  value,
  checked,
  title,
  description,
  onChange,
}: {
  value: Form["protocol"];
  checked: boolean;
  title: string;
  description: string;
  onChange: (value: Form["protocol"]) => void;
}) {
  return (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${checked ? "border-brand bg-brand-soft/55" : "border-line hover:border-line-strong hover:bg-panel-2"}`}>
      <input
        type="radio"
        name="sso-protocol"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-ink-3">{description}</span>
      </span>
    </label>
  );
}
