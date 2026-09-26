import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cx } from "@/lib/ui/format";

export const metadata: Metadata = {
  title: "API",
  description: "Glossary 용어집을 다른 서비스와 연결하는 API 사용 안내",
};

const CURL_EXAMPLE = [
  'curl "$GLOSSARY_URL/api/v1/terms?q=cache&pageSize=10" \\',
  '  -H "Authorization: Bearer glk_<prefix>_<secret>"',
].join("\n");

const JAVASCRIPT_EXAMPLE = [
  'const response = await fetch("/api/v1/terms?q=cache&pageSize=10", {',
  '  headers: { Authorization: `Bearer ${process.env.GLOSSARY_API_KEY}` },',
  "});",
  "const data = await response.json();",
].join("\n");

const SKILL_SOURCE_URL = "https://github.com/geniuskey/glossary/tree/main/skills/glossary";

const SKILL_INSTALL_EXAMPLE = [
  "npx skills add geniuskey/glossary --skill glossary",
  "",
  'export GLOSSARY_URL="https://glossary.example.com"',
  'export GLOSSARY_API_KEY="glk_<prefix>_<secret>"   # read + write',
].join("\n");

const SKILL_PROMPT_EXAMPLE = [
  "회의록에서 확정된 용어만 골라 용어집에 반영해줘.",
  "정의가 빈 용어를 본문 근거로 채워줘.",
  "중복 후보를 검토하고 병합이 필요한 쌍만 알려줘.",
  "이 설계 문서를 검증하고 미등록 용어 후보를 정리해줘.",
].join("\n");

const AGENT_CAN = [
  "용어 검색·등록·수정과 표기 정리 (expectedRevision 필수)",
  "여러 용어 일괄 반영 (dry-run 후 Idempotency-Key)",
  "위키 초안 작성·수정",
  "빈 정의 채우기, 분류 지정, 중복 후보를 다른 개념으로 기록",
  "문서 검증과 미등록 후보 등록·무시 (validate scope)",
];

const HUMAN_ONLY = [
  "위키 공개·보관, 공개 상태를 유지한 수정 — 관리자",
  "용어 삭제 — 관리자",
  "관계 제안·승인·거절 — 로그인 사용자",
  "AI 제안 저장 — 로그인 사용자",
  "중복 병합 — API로 가능하지만 스킬은 사람 확인 후에만 수행",
];

const CHAT_CURL_EXAMPLE = [
  'curl "$GLOSSARY_URL/api/v1/chat" \\',
  '  -H "Authorization: Bearer $GLOSSARY_API_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"question":"캐시와 세션의 차이를 용어집 기준으로 설명해줘"}\'',
].join("\n");

const CHAT_JAVASCRIPT_EXAMPLE = [
  'const response = await fetch(`${process.env.GLOSSARY_URL}/api/v1/chat`, {',
  '  method: "POST",',
  '  headers: {',
  '    Authorization: `Bearer ${process.env.GLOSSARY_API_KEY}`,',
  '    "Content-Type": "application/json",',
  '  },',
  '  body: JSON.stringify({ question: "캐시와 세션의 차이를 설명해줘" }),',
  "});",
  "const data = await response.json();",
  "console.log(data.answer);",
  "console.log(data.grounded?.evidence ?? data.sources);",
].join("\n");

export default async function ApiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={user} title="API" current="api" roomy>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Developer API</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">용어집을 다른 도구에서도 사용하세요</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-2">
          검색·조회·등록·수정을 HTTP API로 연결할 수 있습니다. AI 에이전트에게 용어와 위키 정리를 맡기거나,
          사내 챗봇·문서 린터·배포 검사기가 웹 화면과 같은 기준을 사용하도록 만들어 보세요.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/settings#api-keys" className="btn-primary">API 키 발급·관리</Link>
          <span className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs text-ink-2">
            OpenAPI 원문 <code className="ml-1 font-mono text-ink">GET /api/v1/openapi</code>
          </span>
        </div>
      </header>

      <div className="space-y-8">
        <section className="card overflow-hidden" aria-labelledby="agent-heading">
          <div className="border-b border-line bg-brand-soft/35 px-5 py-4 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">00 · Agent skill</p>
            <h2 id="agent-heading" className="mt-1 text-lg font-semibold text-ink">AI 에이전트에게 용어집 정리 맡기기</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">
              Claude Code 같은 코딩 에이전트에 <code className="font-mono text-ink">glossary</code> 스킬을 설치하면, 에이전트가 이 API로
              기존 용어를 먼저 찾고 근거를 대조한 뒤 리비전 충돌 없이 용어와 위키를 정리합니다. 중복 정리, 빈 정의 채우기,
              미등록 용어 발굴 같은 반복 작업을 맡기기에 좋습니다.
            </p>
          </div>
          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
            <CodeBlock label="설치와 연결" code={SKILL_INSTALL_EXAMPLE} />
            <CodeBlock label="요청 예시" code={SKILL_PROMPT_EXAMPLE} />
          </div>
          <div className="grid gap-5 border-t border-line px-5 py-4 text-xs leading-6 text-ink-2 sm:px-6 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">API 키로 에이전트가 하는 일</h3>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {AGENT_CAN.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">사람의 세션이 필요한 일</h3>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {HUMAN_ONLY.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="mt-2">에이전트는 이 작업들을 변경안으로 정리해 넘기고, 사람이 화면에서 결정합니다.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4 text-xs leading-6 text-ink-2 sm:px-6">
            <span>
              권장 키 scope는 <code className="font-mono text-ink">read</code> + <code className="font-mono text-ink">write</code>,
              문서 검증까지 맡기려면 <code className="font-mono text-ink">validate</code>를 더합니다. scope는 서로 포함하지 않습니다.
            </span>
            <a href={SKILL_SOURCE_URL} target="_blank" rel="noreferrer" className="btn-quiet btn-sm">스킬 원문 보기</a>
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="quick-start-heading">
          <div className="border-b border-line bg-panel-2/45 px-5 py-4 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">01 · Quick start</p>
            <h2 id="quick-start-heading" className="mt-1 text-lg font-semibold text-ink">조회 하나부터 시작하기</h2>
            <p className="mt-1 text-sm leading-6 text-ink-2">API 키를 발급한 뒤 용어 검색 요청에 Bearer 인증을 붙이면 됩니다.</p>
          </div>
          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
            <CodeBlock label="터미널 · curl" code={CURL_EXAMPLE} />
            <CodeBlock label="Node.js · fetch" code={JAVASCRIPT_EXAMPLE} />
          </div>
          <div className="border-t border-line px-5 py-4 text-xs leading-6 text-ink-2 sm:px-6">
            <code className="font-mono text-ink">$GLOSSARY_URL</code>은 서비스 주소로 바꾸세요. API 키 전체 값은 발급 직후 한 번만 표시되므로 환경변수나 비밀 저장소에 보관하고 코드에 직접 커밋하지 마세요.
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="chat-api-heading">
          <div className="border-b border-line bg-brand-soft/35 px-5 py-4 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">02 · Glossary AI</p>
            <h2 id="chat-api-heading" className="mt-1 text-lg font-semibold text-ink">용어집 지식으로 AI 사용하기</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">외부 서비스는 질문만 보내면 됩니다. 서버가 현재 용어집과 설정된 검색 인덱스에서 근거를 찾고, 관리자가 연결한 AI 모델로 답변을 만들어 줍니다.</p>
          </div>
          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
            <CodeBlock label="터미널 · curl" code={CHAT_CURL_EXAMPLE} />
            <CodeBlock label="Node.js · fetch" code={CHAT_JAVASCRIPT_EXAMPLE} />
          </div>
          <div className="grid gap-3 border-t border-line px-5 py-4 text-xs leading-6 text-ink-2 sm:grid-cols-3 sm:px-6">
            <p><strong className="font-semibold text-ink">인증</strong><br /><code className="font-mono text-ink">read</code> scope API 키</p>
            <p><strong className="font-semibold text-ink">답변</strong><br /><code className="font-mono text-ink">answer</code>와 인용 근거</p>
            <p><strong className="font-semibold text-ink">근거</strong><br /><code className="font-mono text-ink">grounded.evidence</code> 또는 <code className="font-mono text-ink">sources</code></p>
          </div>
        </section>

        <section aria-labelledby="auth-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">03 · Authentication</p>
            <h2 id="auth-heading" className="mt-1 text-lg font-semibold text-ink">인증과 권한</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <InfoCard title="API 키" value="Authorization: Bearer …">설정의 API 키 영역에서 발급합니다. 외부 자동화에는 API 키를 사용하세요. scope는 서로 포함하지 않습니다.</InfoCard>
            <InfoCard title="read · 조회" value="GET /terms · POST /chat">검색·상세 조회·RAG 검색과 용어집 기반 AI 질문에 필요한 권한입니다.</InfoCard>
            <InfoCard title="write · 편집" value="POST · PATCH">용어·위키 등록과 수정, 일괄 반영, 가져오기처럼 데이터를 바꾸는 작업에 필요합니다.</InfoCard>
            <InfoCard title="validate · 검증" value="POST /validate">문서 본문의 용어 사용을 검사하고 미등록 후보를 모읍니다.</InfoCard>
          </div>
          <p className="mt-3 text-xs leading-6 text-ink-2">
            API 키로는 삭제, 위키 공개·보관, 관계 제안·승인, AI 제안 저장을 할 수 없습니다. 이 작업은 로그인한 사용자(일부는 관리자)의 세션이 필요합니다.
          </p>
        </section>

        <section aria-labelledby="endpoints-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">04 · Endpoints</p>
            <h2 id="endpoints-heading" className="mt-1 text-lg font-semibold text-ink">자주 쓰는 API</h2>
            <p className="mt-1 text-sm leading-6 text-ink-2">모든 경로의 앞에는 <code className="font-mono text-ink">/api/v1</code>이 붙습니다.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <EndpointGroup title="찾고 읽기">
              <Endpoint method="GET" path="/terms?q=cache" scope="read">검색어·분류·상태로 용어 목록을 조회합니다.</Endpoint>
              <Endpoint method="POST" path="/terms/lookup" scope="read">표기 여러 개가 등록되어 있는지 한 번에 확인합니다.</Endpoint>
              <Endpoint method="GET" path="/terms/{idOrSlug}" scope="read">표준 표기, 정의, 본문, 추가 표기를 상세 조회합니다.</Endpoint>
              <Endpoint method="GET" path="/terms/{idOrSlug}/revisions" scope="read">수정 이력을 조회합니다. 첫 항목의 revisionNumber가 최신 리비전입니다.</Endpoint>
              <Endpoint method="GET" path="/terms/catalog" scope="read">전체 용어·표기·리비전을 한 번에 내려받습니다.</Endpoint>
              <Endpoint method="GET" path="/relations" scope="read">용어 사이의 의미 관계를 조회합니다.</Endpoint>
            </EndpointGroup>
            <EndpointGroup title="등록하고 편집하기">
              <Endpoint method="POST" path="/terms" scope="write">새 용어와 추가 표기를 등록합니다.</Endpoint>
              <Endpoint method="PATCH" path="/terms/{idOrSlug}" scope="write">필요한 필드만 수정합니다. 최신 리비전을 expectedRevision으로 함께 보내세요.</Endpoint>
              <Endpoint method="POST" path="/terms/batch" scope="write">여러 용어를 dry-run으로 검토한 뒤 Idempotency-Key와 함께 반영합니다.</Endpoint>
              <Endpoint method="POST" path="/import" scope="write">Excel·TSV 자료를 검증한 뒤 여러 용어를 가져옵니다.</Endpoint>
            </EndpointGroup>
            <EndpointGroup title="위키">
              <Endpoint method="GET" path="/wiki?q=release" scope="read">위키 문서를 검색합니다. 보관 문서는 기본으로 제외됩니다.</Endpoint>
              <Endpoint method="POST" path="/wiki" scope="write">초안을 만듭니다. 공개는 관리자가 화면에서 결정합니다.</Endpoint>
              <Endpoint method="PATCH" path="/wiki/{slug}" scope="write">초안을 수정합니다. 리비전 잠금이 없으므로 저장 직전에 다시 읽으세요.</Endpoint>
              <Endpoint method="POST" path="/rag/wiki/search" scope="read">공개된 위키에서 의미 기반 검색을 수행합니다.</Endpoint>
            </EndpointGroup>
            <EndpointGroup title="검증과 정리">
              <Endpoint method="POST" path="/validate" scope="validate">문서의 금지·비표준 표기를 찾고 미등록 후보를 모읍니다.</Endpoint>
              <Endpoint method="GET" path="/candidates?status=open" scope="read">문서 검증에서 모인 미등록 후보를 조회합니다.</Endpoint>
              <Endpoint method="POST" path="/candidates/{id}/promote" scope="write">후보를 용어로 등록합니다.</Endpoint>
              <Endpoint method="GET" path="/contributions/duplicates" scope="read">중복 후보 쌍과 검토 상태를 조회합니다.</Endpoint>
            </EndpointGroup>
            <EndpointGroup title="협업과 AI">
              <Endpoint method="POST" path="/chat" scope="read">현재 용어집 지식과 인용 근거를 포함한 AI 답변을 외부 서비스에서 요청합니다.</Endpoint>
              <Endpoint method="GET" path="/contributions/review-queue" scope="read">AI 작업의 상태와 최근 항목을 확인합니다.</Endpoint>
              <Endpoint method="POST · PATCH" path="/contributions/term-definitions" scope="write">본문을 근거로 한줄 정의를 만들고 검토 후 승인합니다.</Endpoint>
              <Endpoint method="POST" path="/rag/search" scope="read">색인된 용어집에서 의미 기반 검색을 수행합니다.</Endpoint>
            </EndpointGroup>
            <EndpointGroup title="계약 확인">
              <Endpoint method="GET" path="/openapi" scope="public">실제 서버가 제공하는 OpenAPI 스펙을 JSON으로 받습니다.</Endpoint>
              <Endpoint method="GET" path="/health" scope="public">서비스가 응답 가능한지 확인합니다.</Endpoint>
            </EndpointGroup>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]" aria-labelledby="response-heading">
          <div className="card p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">05 · Safe updates</p>
            <h2 id="response-heading" className="mt-1 text-lg font-semibold text-ink">수정은 덮어쓰지 않도록</h2>
            <p className="mt-3 text-sm leading-6 text-ink-2">
              <code className="font-mono text-ink">{"GET /terms/{idOrSlug}/revisions"}</code>의 첫 <code className="font-mono text-ink">revisionNumber</code>(또는 카탈로그의 <code className="font-mono text-ink">revision</code>)를 <code className="font-mono text-ink">expectedRevision</code>으로 보내면, 그 사이 다른 사람이 수정한 경우 409로 알려 줍니다. 응답을 다시 읽고 변경 내용을 합친 뒤 재시도하세요.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-panel-2/50 p-3 font-mono text-xs leading-6 text-ink-2"><code>{'{ "error": { "code": "revision_conflict", "message": "다른 사람이 먼저 수정했습니다." } }'}</code></pre>
          </div>
          <div className="card p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">06 · Full contract</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Swagger / OpenAPI로 더 자세히</h2>
            <p className="mt-3 text-sm leading-6 text-ink-2">
              <code className="font-mono text-ink">GET /api/v1/openapi</code> 응답은 현재 배포된 서버의 경로·파라미터·요청 본문·에러 응답을 그대로 설명합니다. JSON을 내려받아 Swagger UI나 Swagger Editor에서 열면 인터랙티브 문서로 볼 수 있습니다.
            </p>
            <Link href="/settings#api-keys" className="btn-quiet btn-sm mt-4">API 키 발급 화면 열기</Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-ink-3">{label}</p>
      <pre className="overflow-x-auto rounded-lg border border-line bg-ink px-3.5 py-3.5 font-mono text-xs leading-6 text-panel"><code>{code}</code></pre>
    </div>
  );
}

function InfoCard({ title, value, children }: { title: string; value: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <code className="mt-2 block font-mono text-xs text-brand">{value}</code>
      <p className="mt-2 text-xs leading-5 text-ink-2">{children}</p>
    </div>
  );
}

function EndpointGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden" aria-label={title}>
      <h3 className="border-b border-line bg-panel-2/45 px-4 py-3 text-sm font-semibold text-ink">{title}</h3>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Endpoint({ method, path, scope, children }: { method: string; path: string; scope: "read" | "write" | "validate" | "public"; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className={cx("mt-0.5 shrink-0 font-mono text-[10px] font-semibold", scope === "write" ? "text-accent" : scope === "public" ? "text-ink-3" : "text-brand")}>{method}</span>
      <div className="min-w-0">
        <code className="break-all font-mono text-xs text-ink">{path}</code>
        <p className="mt-1 text-xs leading-5 text-ink-2">{children}</p>
      </div>
    </div>
  );
}
