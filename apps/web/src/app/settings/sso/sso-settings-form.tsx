"use client";

import { useEffect, useState } from "react";
import { formatClaimList, parseClaimList } from "@/lib/auth/sso/claims";

// api-keys-panel.tsx와 같은 이유로 상태를 갖는 이 조각만 Client Component다 —
// page.tsx는 평범한 Server Component로 남아 인증 게이트(PROTO B)를 그대로 받는다.

interface SsoView {
  mode: SsoMode;
  enabled: boolean;
  passwordLoginEnabled: boolean;
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
  mode: SsoMode;
  enabled: boolean;
  passwordLoginEnabled: boolean;
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
  ssoMode: SsoMode;
  proxyAvailable: boolean;
  trusted: boolean;
  detected: boolean;
  headerNames: { preferredUsername: string; email: string; groups: string };
  presentHeaders: string[];
  missingHeaders: string[];
  identity: { email: string; name: string; groups: string[]; organization: string | null } | null;
}

export type SsoMode = "disabled" | "oidc" | "oauth2" | "oauth2-proxy";

const MODE_LABEL: Record<SsoMode, string> = {
  disabled: "SSO 사용하지 않음",
  oidc: "OpenID Connect",
  oauth2: "OAuth 2.0",
  "oauth2-proxy": "oauth2-proxy",
};

export interface SsoRuntimeView {
  authMode: ProxyHeaderCheck["authMode"];
  proxyAvailable: boolean;
  proxyHeaderNames: ProxyHeaderCheck["headerNames"];
}

export function effectiveSsoMode(configured: { mode: SsoMode }): SsoMode {
  return configured.mode;
}

export function proxyAccessPolicyPayload(form: {
  passwordLoginEnabled: boolean;
  allowedGroups: string;
  adminGroups: string;
  autoCreate: boolean;
}) {
  return {
    mode: "oauth2-proxy" as const,
    passwordLoginEnabled: form.passwordLoginEnabled,
    allowedGroups: parseClaimList(form.allowedGroups),
    adminGroups: parseClaimList(form.adminGroups),
    autoCreate: form.autoCreate,
  };
}

function toForm(sso: SsoView): Form {
  return {
    mode: sso.mode,
    enabled: sso.enabled,
    passwordLoginEnabled: sso.passwordLoginEnabled,
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

export function SsoSettingsForm({ runtime }: { runtime: SsoRuntimeView }) {
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

  function selectMode(mode: SsoMode) {
    if (mode === "oauth2-proxy" && !runtime.proxyAvailable) return;
    if (mode === "disabled" && !form?.passwordLoginEnabled) return;
    if (mode === "disabled") {
      setForm((prev) => prev ? { ...prev, mode, enabled: false } : prev);
      return;
    }
    if (mode === "oauth2-proxy") {
      setForm((prev) => prev ? { ...prev, mode, enabled: false } : prev);
      return;
    }
    setForm((prev) => {
      if (!prev) return prev;
      const scopes = parseClaimList(prev.scopes).filter((scope) => scope !== "openid");
      return {
        ...prev,
        mode,
        enabled: true,
        protocol: mode,
        scopes: formatClaimList(mode === "oidc" ? ["openid", ...scopes] : scopes),
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
        body: JSON.stringify(form.mode === "oauth2-proxy" ? proxyAccessPolicyPayload(form) : {
          mode: form.mode,
          enabled: form.enabled,
          passwordLoginEnabled: form.passwordLoginEnabled,
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
      setMessage({
        kind: "ok",
        text: form.mode === "oauth2-proxy" ? "oauth2-proxy와 SSO 접근 정책을 저장했습니다." : "SSO 설정을 저장했습니다.",
      });
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

  const activeMode = effectiveSsoMode(view);
  const mode = effectiveSsoMode(form);
  const directMode = mode === "oidc" || mode === "oauth2";
  const modeChanged = activeMode !== mode;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-ink">ID/비밀번호 로그인</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">
          로컬 이메일 계정의 로그인과 새 계정 가입을 허용할지 정합니다.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-panel-2 p-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.passwordLoginEnabled}
            disabled={mode === "disabled" && form.passwordLoginEnabled}
            onChange={(event) => set("passwordLoginEnabled", event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span>
            <span className="block font-medium">ID/비밀번호 로그인 허용</span>
            <span className="mt-1 block text-xs leading-5 text-ink-3">
              끄면 로그인 화면의 이메일 폼과 가입 경로가 닫히고 회사 로그인만 사용할 수 있습니다.
            </span>
          </span>
        </label>
        {mode === "disabled" && form.passwordLoginEnabled && (
          <p className="mt-2 text-xs text-ink-3">SSO를 사용하지 않는 동안에는 유일한 로그인 경로이므로 끌 수 없습니다.</p>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink">SSO 로그인 방식</h2>
            <p className="mt-1 text-xs leading-5 text-ink-3">
              네 가지 방식 중 현재 배포에 실제 적용되는 하나를 표시합니다.
            </p>
          </div>
          <span className="chip shrink-0">적용 중 · {MODE_LABEL[activeMode]}</span>
        </div>

        {runtime.authMode === "oauth2-proxy" ? (
          <div className="note-warn mt-4 text-xs leading-5">
            <p className="font-medium">기존 환경변수 <code className="font-mono" translate="no">AUTH_MODE=oauth2-proxy</code>를 호환 모드로 읽고 있습니다.</p>
            <p className="mt-1">
              앞으로는 <code className="font-mono" translate="no">OAUTH2_PROXY_ENABLED=true</code>로 바꾸고 기존 <code className="font-mono" translate="no">AUTH_MODE</code>는 제거하세요.
              환경변수는 proxy 사용 가능 여부만 정하며, 실제 로그인 방식은 이 화면에서 저장합니다.
            </p>
          </div>
        ) : runtime.proxyAvailable ? (
          <p className="note-ok mt-4 text-xs leading-5">
            네 가지 로그인 방식 모두 이 화면에서 선택합니다. 이 배포는 oauth2-proxy 사용이 허용되어 있습니다.
          </p>
        ) : (
          <p className="note-warn mt-4 text-xs leading-5">
            oauth2-proxy를 선택하려면 배포 환경에 <code className="font-mono" translate="no">OAUTH2_PROXY_ENABLED=true</code>를 설정하고 앱을 다시 시작하세요.
            나머지 세 방식은 지금 바로 선택할 수 있습니다.
          </p>
        )}

        <fieldset className="mt-4">
          <legend className="sr-only">SSO 로그인 방식 선택</legend>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ModeOption
              value="disabled"
              checked={mode === "disabled"}
              title="SSO 사용하지 않음"
              description="회사 로그인 없이 로컬 계정만 사용합니다."
              disabled={!form.passwordLoginEnabled}
              disabledHint={!form.passwordLoginEnabled ? "ID/비밀번호 로그인 허용 필요" : undefined}
              onChange={selectMode}
            />
            <ModeOption
              value="oidc"
              checked={mode === "oidc"}
              title="OpenID Connect"
              description="ID 토큰의 서명과 표준 보안 claim을 검증합니다."
              disabled={false}
              onChange={selectMode}
            />
            <ModeOption
              value="oauth2"
              checked={mode === "oauth2"}
              title="OAuth 2.0"
              description="Access Token으로 사용자 정보 API를 호출합니다."
              disabled={false}
              onChange={selectMode}
            />
            <ModeOption
              value="oauth2-proxy"
              checked={mode === "oauth2-proxy"}
              title="oauth2-proxy"
              description="앞단 프록시가 인증하고 검증된 헤더를 전달합니다."
              disabled={!runtime.proxyAvailable}
              disabledHint={runtime.proxyAvailable ? "이 배포에서 선택 가능" : "OAUTH2_PROXY_ENABLED 필요"}
              onChange={selectMode}
            />
          </div>
        </fieldset>
        {modeChanged && (
          <p className="mt-3 text-xs font-medium text-brand" role="status">
            {MODE_LABEL[mode]} 방식은 아래 저장 버튼을 누른 뒤 적용됩니다.
          </p>
        )}
      </section>

      {directMode && (
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">{MODE_LABEL[mode]} 연결</h2>
          <p className="mt-1 text-xs text-ink-3">
            인증 서버에는 아래 리디렉션 URI를 등록하세요. 인가 코드 + PKCE를 사용합니다.
          </p>

          <div className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
            <span className="text-[11px] text-ink-3">리디렉션 URI</span>
            <p className="break-all font-mono text-xs text-ink">{redirectUri}</p>
          </div>

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
      )}

      {mode === "oauth2-proxy" && <section className="card p-5">
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

        <p className="mt-3 text-xs text-ink-2">
          <code className="font-mono" translate="no">OAUTH2_PROXY_ENABLED={runtime.proxyAvailable ? "true" : "false"}</code>
          {runtime.authMode === "oauth2-proxy" && <>
            <span aria-hidden="true"> · </span>
            <span>기존 AUTH_MODE 호환 사용 중</span>
          </>}
        </p>

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
              저장 모드: {MODE_LABEL[proxyCheck.ssoMode]} · {proxyCheck.proxyAvailable ? "proxy 사용 가능" : "proxy 사용 불가"} · {proxyCheck.trusted ? "헤더 검사 허용" : "헤더 검사 안 함"}
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-2 text-xs text-ink-2 sm:grid-cols-3">
          <HeaderName label="닉네임" value={proxyCheck?.headerNames.preferredUsername ?? runtime.proxyHeaderNames.preferredUsername} />
          <HeaderName label="사용자 식별·이메일" value={proxyCheck?.headerNames.email ?? runtime.proxyHeaderNames.email} />
          <HeaderName label="그룹·조직" value={proxyCheck?.headerNames.groups ?? runtime.proxyHeaderNames.groups} />
        </div>

        <p className="note-warn mt-4 text-xs leading-5">
          앱 포트를 외부에 직접 공개하지 말고, nginx가 클라이언트의 동일한 X-Forwarded-* 헤더를 제거한 뒤
          oauth2-proxy가 확인한 값으로 덮어쓰게 구성하세요. 직접 접속이 가능하면 헤더를 위조해 다른 사용자를 사칭할 수 있습니다.
        </p>
      </section>}

      {directMode && <section className="card p-5">
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
      </section>}

      {mode !== "disabled" && <section className="card p-5">
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
      </section>}

      {message && (
        <p role={message.kind === "bad" ? "alert" : "status"} className={message.kind === "ok" ? "note-ok" : "note-danger"}>
          {message.text}
        </p>
      )}

      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy
            ? "저장 중…"
            : mode === "oauth2-proxy"
              ? "접근 정책 저장"
              : mode === "disabled"
                ? "SSO 사용 안 함 저장"
                : `${MODE_LABEL[mode]} 설정 저장`}
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

function ModeOption({
  value,
  checked,
  title,
  description,
  disabled,
  disabledHint,
  onChange,
}: {
  value: SsoMode;
  checked: boolean;
  title: string;
  description: string;
  disabled: boolean;
  disabledHint?: string;
  onChange: (value: SsoMode) => void;
}) {
  return (
    <label className={`flex gap-3 rounded-xl border p-3 transition-colors ${
      checked
        ? "border-brand bg-brand-soft/55"
        : disabled
          ? "cursor-not-allowed border-line bg-panel-2 opacity-70"
          : "cursor-pointer border-line hover:border-line-strong hover:bg-panel-2"
    }`}>
      <input
        type="radio"
        name="sso-mode"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-ink-3">{description}</span>
        {disabledHint && <span className="mt-1.5 block text-[11px] font-medium text-brand">{disabledHint}</span>}
      </span>
    </label>
  );
}
