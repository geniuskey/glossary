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
          검색·조회·등록·수정을 HTTP API로 연결할 수 있습니다. 사내 챗봇, 문서 린터, 배포 검사기처럼
          용어를 읽거나 갱신하는 도구가 웹 화면과 같은 기준을 사용하도록 만들어 보세요.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/settings#api-keys" className="btn-primary">API 키 발급·관리</Link>
          <span className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs text-ink-2">
            OpenAPI 원문 <code className="ml-1 font-mono text-ink">GET /api/v1/openapi</code>
          </span>
        </div>
      </header>

      <div className="space-y-8">
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
          <div className="grid gap-3 md:grid-cols-3">
            <InfoCard title="API 키" value="Authorization: Bearer …">설정의 API 키 영역에서 발급합니다. 외부 자동화에는 API 키를 사용하세요.</InfoCard>
            <InfoCard title="read · 조회" value="GET /terms · POST /chat">검색·상세 조회·RAG 검색과 용어집 기반 AI 질문에 필요한 권한입니다.</InfoCard>
            <InfoCard title="write · 편집" value="POST · PATCH">용어 등록·수정, 가져오기, 협업 제안 승인처럼 데이터를 바꾸는 작업에 필요합니다.</InfoCard>
          </div>
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
            </EndpointGroup>
            <EndpointGroup title="등록하고 편집하기">
              <Endpoint method="POST" path="/terms" scope="write">새 용어와 추가 표기를 등록합니다.</Endpoint>
              <Endpoint method="PATCH" path="/terms/{idOrSlug}" scope="write">필요한 필드만 수정합니다. 사람이 쓰는 도구는 expectedRevision을 함께 보내세요.</Endpoint>
              <Endpoint method="POST" path="/import" scope="write">Excel·TSV 자료를 검증한 뒤 여러 용어를 가져옵니다.</Endpoint>
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
              상세 조회에서 받은 <code className="font-mono text-ink">revision</code>을 <code className="font-mono text-ink">expectedRevision</code>으로 보내면, 그 사이 다른 사람이 수정한 경우 409로 알려 줍니다. 응답을 다시 읽고 변경 내용을 합친 뒤 재시도하세요.
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

function Endpoint({ method, path, scope, children }: { method: string; path: string; scope: "read" | "write" | "public"; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className={cx("mt-0.5 shrink-0 font-mono text-[10px] font-semibold", scope === "write" ? "text-accent" : scope === "read" ? "text-brand" : "text-ink-3")}>{method}</span>
      <div className="min-w-0">
        <code className="break-all font-mono text-xs text-ink">{path}</code>
        <p className="mt-1 text-xs leading-5 text-ink-2">{children}</p>
      </div>
    </div>
  );
}
