// AI-Lint 통합의 계약이다. M1에서는 생성기를 배선하지 않고 손으로 유지한다
// (라우트 10여 개에 비해 배선 비용이 크다는 계획서 판단을 받아들인다).
//
// R129: 손으로 유지되는 리터럴은 구조 테스트로 잠근다 — R105(예약 slug),
// R107(라우트 디렉터리)에서 이미 쓴 패턴이다. `apps/web/tests/openapi.test.ts`가
// `app/api/v1/` 밑 라우트가 전부 여기 paths에 있는지 검사하므로, 새 라우트를
// 만들고 스펙에 안 넣으면 테스트가 깨진다.
//
// Ruling: 스펙을 yaml 파일이 아니라 이 TS 모듈에 둔다 — (1) standalone 이미지는
// docs/*.yaml을 추적하지 않아 런타임에 읽을 수 없고, (2) 구조 테스트가 실제로
// 서빙되는 바로 그 객체를 읽으므로 문서와 응답이 갈라질 수 없다.
// 틀렸을 때의 비용: yaml을 기대하는 외부 도구가 있으면 GET /api/v1/openapi의
// JSON을 변환해야 한다(docs/operations.md에 명령을 적어뒀다).

import { relationPaths } from "./terms/relation-openapi";

const errorEnvelope = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
    },
  },
};

// 전 엔드포인트 공통 규약이라 응답마다 스키마를 반복하지 않고 참조만 건다.
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const json = (description: string, schema: unknown) => ({
  description,
  content: { "application/json": { schema } },
});

const termQualityProfileSchema = {
  type: "string",
  enum: ["auto", "mapping", "context", "guidance"],
  description: "auto는 표기와 상태를 보고 기준을 선택하고, 나머지는 용어별 명시 기준입니다.",
};
const businessCategorySchema = {
  type: ["string", "null"],
  maxLength: 64,
  description: "관리자가 구성한 업무 분류의 안정적인 key. 표시 이름은 categoryLabel로 제공됩니다.",
};
const businessCategoriesSchema = {
  type: "array",
  maxItems: 12,
  items: { type: "string", maxLength: 64 },
  description: "분류 체계에 등록된 업무 분류 key 목록. 기존 단일 문자열 요청도 호환됩니다.",
};
  const statusSchema = {
    type: "string",
    enum: ["draft", "active"],
    readOnly: true,
    description: "시스템이 용어 정리 기준 충족 여부를 자동 판정합니다. draft는 보완 필요, active는 기준 충족입니다.",
  };

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Glossary 용어집 API",
    version: "1.0.0",
    description:
      "센서 제품군 용어집. 사내망 온프레미스 배포이며 평문 HTTP로 동작할 수 있다 " +
      "(docs/operations.md 참조). 모든 에러 응답은 { error: { code, message, details? } } 형태다.",
    license: {
      name: "Apache License 2.0",
      identifier: "Apache-2.0",
    },
  },
  servers: [{ url: "/api/v1" }],
  // 인증 수단은 둘이다. 화면은 세션 쿠키를, AI-Lint 같은 외부 도구는 API 키를 쓴다.
  security: [{ sessionCookie: [] }, { apiKey: [] }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "glossary_session" },
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "Authorization: Bearer glk_<prefix>_<secret>",
      },
    },
    schemas: {
      Error: errorEnvelope,
      TermSummary: {
        type: "object",
        required: ["id", "slug", "qualityProfile", "domain", "categories", "categoryLabels", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          qualityProfile: termQualityProfileSchema,
          nameEn: { type: ["string", "null"] },
          nameKo: { type: ["string", "null"] },
          domain: { type: "array", items: { type: "string" } },
          categories: businessCategoriesSchema,
          category: businessCategorySchema,
          categoryLabel: { type: ["string", "null"] },
          categoryLabels: { type: "array", items: { type: "string" } },
          topic: { type: ["string", "null"] },
          ownerId: { type: ["string", "null"], format: "uuid" },
          ownerName: { type: ["string", "null"], description: "SSO 그룹/조직이 적용된 담당자 라벨" },
          status: statusSchema,
        },
      },
      Surface: {
        type: "object",
        required: ["id", "text", "lang", "kind", "caseSensitive"],
        properties: {
          id: { type: "string", format: "uuid" },
          text: { type: "string" },
          lang: { type: "string" },
          kind: {
            type: "string",
            enum: ["canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden"],
          },
          caseSensitive: { type: "boolean" },
        },
      },
      TermDetail: {
        allOf: [
          { $ref: "#/components/schemas/TermSummary" },
          {
            type: "object",
            required: ["updatedAt", "surfaces", "homonyms"],
            properties: {
              fullNameEn: { type: ["string", "null"] },
              fullNameKo: { type: ["string", "null"] },
              definitionMd: { type: ["string", "null"] },
              bodyMd: { type: ["string", "null"] },
              // R62: 라우트가 명시적으로 ISO 문자열로 직렬화한다. Date가 아니다.
              updatedAt: { type: "string", format: "date-time" },
              surfaces: { type: "array", items: { $ref: "#/components/schemas/Surface" } },
              homonyms: { type: "array", items: { $ref: "#/components/schemas/TermSummary" } },
            },
          },
        ],
      },
      WikiTermLink: {
        type: "object",
        required: ["id", "slug", "title", "role", "domain"],
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          title: { type: "string" },
          role: { type: "string", enum: ["primary", "related"] },
          domain: { type: "array", items: { type: "string" } },
        },
      },
      WikiPage: {
        type: "object",
        required: ["id", "slug", "title", "summary", "domain", "revision", "status", "terms", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          title: { type: "string" },
          summary: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 },
          content: { type: "string" },
          domain: { type: "array", items: { type: "string" } },
          revision: { type: "integer", minimum: 1 },
          status: { type: "string", enum: ["draft", "published", "archived"] },
          terms: { type: "array", items: { $ref: "#/components/schemas/WikiTermLink" } },
          createdBy: { type: ["string", "null"], format: "uuid" },
          updatedBy: { type: ["string", "null"], format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  paths: {
    ...relationPaths,
    "/account": {
      patch: {
        summary: "현재 사용자의 표시 이름 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        } } } },
        responses: {
          "200": json("변경된 사용자", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "404": errorResponse("not_found"),
        },
      },
    },
    "/account/sso-refresh": {
      post: {
        summary: "현재 사용자의 SSO 이름·이메일·그룹 다시 가져오기",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("즉시 갱신된 사용자 또는 SSO 재인증 시작 주소", {
            type: "object",
            required: ["refreshed"],
            properties: {
              refreshed: { type: "boolean" },
              user: { type: "object" },
              redirectTo: { type: "string" },
            },
          }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("operation_conflict"),
        },
      },
    },
    "/openapi": {
      get: {
        summary: "이 스펙 자체를 JSON으로 돌려준다",
        security: [],
        responses: { "200": json("OpenAPI 3.1 문서", { type: "object" }) },
      },
    },
    "/health": {
      get: {
        summary: "DB 연결 포함 상태 확인",
        security: [],
        responses: {
          "200": json("정상", { type: "object", properties: { status: { type: "string" } } }),
          "503": errorResponse("DB에 연결할 수 없다"),
        },
      },
    },
    "/setup": {
      // 최초 설정 창구다. users 테이블이 비어 있을 때만 관리자 계정을 만든다.
      // 설정이 끝난 뒤에는 403(forbidden)이다. 인증이 필요 없다(security: []).
      post: {
        summary: "최초 관리자 계정 생성 (users가 비어 있을 때만)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("glossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "403": errorResponse("forbidden — 이미 초기 설정이 끝났다"),
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "세션 쿠키 발급",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("glossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized — 계정 없음과 비밀번호 불일치를 구분하지 않는다"),
        },
      },
    },
    "/auth/register": {
      // R131: 개방 가입. security: []는 "인증 없이 부른다"는 뜻이다 — 계정을
      // 만드는 창구라 세션도 API 키도 없다.
      post: {
        summary: "계정 만들기 (누구나)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                  name: { type: "string", description: "비우면 이메일이 표시 이름이 된다" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("계정을 만들고 glossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
          "400": errorResponse("validation_failed — 이메일 형식 또는 8자 미만 비밀번호"),
          "403": errorResponse("forbidden — 계정이 하나도 없다. /setup으로 관리자를 먼저 만든다"),
          "409": errorResponse("email_taken — 이미 가입된 이메일(대소문자 무시)"),
        },
      },
    },
    "/auth/logout": {
      // 상태를 바꾸므로 POST다. GET으로 만들면 SameSite=Lax 하나뿐인 CSRF 방어가 무너진다.
      post: {
        summary: "세션 폐기",
        responses: { "200": json("쿠키를 만료시킨다", { type: "object" }) },
      },
    },
    "/admin/users": {
      get: {
        summary: "관리자용 사용자 목록",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("사용자와 활성 세션 수", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/exports/terms": {
      get: {
        summary: "전체 용어집 읽기 전용 스냅샷 다운로드",
        description:
          "관리자 세션으로만 현재 서버의 용어·표기·분류·관계를 JSON 스냅샷으로 내려받는다. " +
          "이 형식은 일반 POST /import에서 거부되며 자동 복원하지 않는다.",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("다운로드 가능한 읽기 전용 용어집 스냅샷", {
            type: "object",
            required: ["format", "version", "readOnly", "exportedAt", "counts", "data"],
            properties: {
              format: { type: "string", const: "geniuskey.glossary.snapshot" },
              version: { type: "integer", const: 1 },
              readOnly: { type: "boolean", const: true },
              exportedAt: { type: "string", format: "date-time" },
              counts: { type: "object" },
              data: { type: "object" },
            },
          }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/home-content": {
      get: {
        summary: "홈 첫 화면 소개 문구 조회",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("{ settings: { eyebrow, title, description } }", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      patch: {
        summary: "홈 첫 화면 소개 문구 수정",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["eyebrow", "title", "description"],
                additionalProperties: false,
                properties: {
                  eyebrow: { type: "string", minLength: 1, maxLength: 48 },
                  title: { type: "string", minLength: 1, maxLength: 120 },
                  description: { type: "string", minLength: 1, maxLength: 280 },
                },
              },
            },
          },
        },
        responses: {
          "200": json("저장된 홈 문구", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/menu-settings": {
      get: {
        summary: "사이드바 메뉴 표시 설정 조회",
        description: "워크스페이스 전체에 적용되는 메뉴 표시 여부를 조회한다. 용어집 시트 메뉴는 항상 활성화된다.",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("{ settings: { ...menu visibility flags } }", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      patch: {
        summary: "사이드바 메뉴 표시 설정 수정",
        description: "워크스페이스 전체의 부가 메뉴 표시 여부를 수정한다. 용어집 시트 메뉴는 끌 수 없다.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "contribute",
                  "field-completion",
                  "sheet",
                  "classifications",
                  "graph",
                  "chat",
                  "meetings",
                  "wiki",
                  "api",
                  "import",
                  "statistics",
                ],
                additionalProperties: false,
                properties: {
                  contribute: { type: "boolean" },
                  "field-completion": { type: "boolean" },
                  sheet: { type: "boolean", const: true },
                  classifications: { type: "boolean" },
                  graph: { type: "boolean" },
                  chat: { type: "boolean" },
                  meetings: { type: "boolean" },
                  wiki: { type: "boolean" },
                  api: { type: "boolean" },
                  import: { type: "boolean" },
                  statistics: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("저장된 메뉴 표시 설정", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/term-quality": {
      get: {
        summary: "용어 작성 수준 조회",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("{ settings: { definitionMinChars, bodyMinChars } }", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      post: {
        summary: "저장하지 않고 콘텐츠 완성도 최소 길이 변경 영향을 미리 계산",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["definitionMinChars", "bodyMinChars"],
            additionalProperties: false,
            properties: {
              definitionMinChars: { type: "integer", minimum: 0, maximum: 10000 },
              bodyMinChars: { type: "integer", minimum: 0, maximum: 10000 },
            },
          } } },
        },
        responses: {
          "200": json("프로필별 충족 현황 미리보기", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      patch: {
        summary: "용어 작성 수준 수정",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["definitionMinChars", "bodyMinChars"],
                additionalProperties: false,
                properties: {
                  definitionMinChars: { type: "integer", minimum: 0, maximum: 10000 },
                  bodyMinChars: { type: "integer", minimum: 0, maximum: 10000 },
                },
              },
            },
          },
        },
        responses: {
          "200": json("저장된 용어 작성 수준", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/term-definitions": {
      get: {
        summary: "본문은 있고 한줄 정의가 없는 용어의 LLM 검토 대기열 조회",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("{ items, total }", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      post: {
        summary: "용어 본문을 근거로 한줄 정의 제안을 생성하고 리비전별로 캐시",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId"],
          additionalProperties: false,
          properties: { termId: { type: "string", format: "uuid" }, force: { type: "boolean", default: false } },
        } } } },
        responses: {
          "200": json("{ suggestion }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "409": errorResponse("ai_not_enabled 또는 operation_conflict"),
          "422": errorResponse("본문 근거 부족"),
          "502": errorResponse("ai_provider_error"),
        },
      },
      patch: {
        summary: "관리자가 검토한 한줄 정의 한 건 승인",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "definitionMd", "expectedRevision"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            definitionMd: { type: "string", minLength: 1, maxLength: 1000 },
            expectedRevision: { type: "integer", minimum: 1 },
          },
        } } } },
        responses: {
          "200": json("승인 결과", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "409": errorResponse("revision_conflict 또는 operation_conflict"),
        },
      },
    },
    "/admin/ai-config": {
      get: {
        summary: "관리자용 AI 연결 설정 조회 (비밀값은 마스킹)",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("API 키 존재 여부와 custom header 이름만 포함한 설정", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      patch: {
        summary: "Gemini 또는 OpenAI-compatible 연결 설정 저장",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["enabled", "autoReviewEnabled", "provider", "baseUrl", "model", "customHeaders"],
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            autoReviewEnabled: { type: "boolean", description: "정리 대기 용어의 수정 제안을 백그라운드에서 미리 생성" },
            provider: { type: "string", enum: ["gemini", "openai_compatible"] },
            baseUrl: { type: "string", format: "uri", maxLength: 2000 },
            model: { type: "string", minLength: 1, maxLength: 200 },
            apiKey: { type: ["string", "null"], description: "생략·빈 문자열이면 기존 값 유지, null이면 삭제" },
            customHeaders: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" } } } },
          },
        } } } },
        responses: {
          "200": json("저장된 마스킹 설정", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/ai-config/test": {
      post: {
        summary: "저장된 AI 설정으로 연결 시험",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("연결됨", { type: "object", properties: { ok: { type: "boolean" } } }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
          "502": errorResponse("ai_provider_error"),
        },
      },
    },
    "/admin/ai-config/models": {
      post: {
        summary: "저장된 값과 관리자 입력을 이용해 선택 가능한 AI 모델 조회",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["provider", "baseUrl", "customHeaders"],
          additionalProperties: false,
          properties: {
            provider: { type: "string", enum: ["gemini", "openai_compatible"] },
            baseUrl: { type: "string", format: "uri", maxLength: 2000 },
            apiKey: { type: ["string", "null"], description: "생략·빈 문자열이면 저장된 키 사용" },
            customHeaders: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" }, configured: { type: "boolean" } } } },
          },
        } } } },
        responses: {
          "200": json("선택 가능한 모델 ID와 표시 이름", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
          "502": errorResponse("ai_provider_error"),
        },
      },
    },
    "/admin/ai-observability": {
      get: {
        summary: "최근 AI 호출·실패·지연·토큰과 RAG/검토 큐 상태 조회",
        description: "프롬프트·응답 원문과 비밀값은 저장하거나 반환하지 않고 운영 집계만 제공한다.",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "hours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 720, default: 24 } }],
        responses: {
          "200": json("AI 운영 집계와 큐 상태", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/rag-config": {
      get: {
        summary: "관리자용 RAG·Embedding·Reranker 설정과 색인 상태 조회",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("비밀값을 제외한 RAG 설정과 현재 색인 통계", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
      patch: {
        summary: "Embedding/Reranker API와 RAG 청크 설정 저장",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["enabled", "embeddingProvider", "embeddingBaseUrl", "embeddingModel", "embeddingCustomHeaders", "rerankerEnabled", "rerankerProvider", "rerankerBaseUrl", "rerankerModel", "rerankerCustomHeaders", "chunkSize", "chunkOverlap", "topK"],
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            chatEnabled: { type: "boolean", description: "챗봇이 Embedding 기반 하이브리드 검색을 보조로 사용할지 여부" },
            embeddingProvider: { type: "string", enum: ["openai_compatible", "gemini"] },
            embeddingBaseUrl: { type: "string", format: "uri", maxLength: 2000 },
            embeddingModel: { type: "string", minLength: 1, maxLength: 200 },
            embeddingApiKey: { type: ["string", "null"], description: "생략·빈 문자열이면 기존 값 유지, null이면 삭제" },
            embeddingCustomHeaders: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" }, configured: { type: "boolean" } } } },
            rerankerEnabled: { type: "boolean" },
            rerankerProvider: { type: "string", enum: ["cohere_compatible", "openai_compatible"] },
            rerankerBaseUrl: { type: "string", format: "uri", maxLength: 2000 },
            rerankerModel: { type: "string", minLength: 1, maxLength: 200 },
            rerankerApiKey: { type: ["string", "null"], description: "생략·빈 문자열이면 기존 값 유지, null이면 삭제" },
            rerankerCustomHeaders: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" }, configured: { type: "boolean" } } } },
            chunkSize: { type: "integer", minimum: 400, maximum: 8000 },
            chunkOverlap: { type: "integer", minimum: 0, maximum: 2000 },
            topK: { type: "integer", minimum: 1, maximum: 50 },
          },
        } } } },
        responses: {
          "200": json("저장된 설정과 재색인 대기 수", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
        },
      },
    },
    "/admin/rag-config/models": {
      post: {
        summary: "OpenAI-compatible RAG 서버의 Embedding/Reranker 모델 목록 조회",
        description: "공용 /v1/models 목록에서 Embedding은 ID에 embed, Reranker는 ID에 reranker가 포함된 모델만 반환한다. 설정은 저장하지 않는다.",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["endpoint", "baseUrl", "customHeaders"],
          additionalProperties: false,
          properties: {
            endpoint: { type: "string", enum: ["embedding", "reranker"] },
            provider: { type: "string", enum: ["openai_compatible"], description: "생략 가능하며 현재 OpenAI-compatible만 지원" },
            baseUrl: { type: "string", format: "uri", maxLength: 2000 },
            apiKey: { type: ["string", "null"], description: "생략·빈 문자열이면 저장된 값 유지, null이면 저장된 키를 사용하지 않음" },
            customHeaders: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" }, configured: { type: "boolean" } } } },
          },
        } } } },
        responses: {
          "200": json("필터링된 모델 목록", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
          "502": errorResponse("rag_provider_error"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/admin/rag-config/reindex": {
      post: {
        summary: "전체 용어집을 RAG 색인 대기열에 넣는다",
        security: [{ sessionCookie: [] }],
        responses: {
          "202": json("대기열에 들어간 용어 수", { type: "object", properties: { ok: { type: "boolean" }, queued: { type: "integer" } } }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/admin/rag-config/test": {
      post: {
        summary: "저장된 Embedding/Reranker 설정으로 연결 시험",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("연결됨", { type: "object", properties: { ok: { type: "boolean" }, embedding: { type: "boolean" }, reranker: { type: "boolean" } } }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만 사용 가능"),
          "502": errorResponse("rag_provider_error"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/admin/categories": {
      get: {
        summary: "업무 분류 목록과 사용 건수 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: {
          "200": json("{ categories }", { type: "object" }),
          "401": errorResponse("unauthorized"),
        },
      },
      post: {
        summary: "업무 분류 추가",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["labelKo", "labelEn"], additionalProperties: false, properties: { labelKo: { type: "string", minLength: 1, maxLength: 60 }, labelEn: { type: "string", minLength: 1, maxLength: 60 } } } } } },
        responses: {
          "201": json("{ category }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("operation_conflict — 같은 이름이 이미 있음"),
        },
      },
      patch: {
        summary: "업무 분류 표시 순서 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["keys"], additionalProperties: false, properties: { keys: { type: "array", items: { type: "string" } } } } } } },
        responses: {
          "200": json("{ ok: true }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("operation_conflict — 목록이 변경됨"),
        },
      },
    },
    "/admin/categories/{key}": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string", maxLength: 64 } }],
      patch: {
        summary: "업무 분류 표시 이름 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["labelKo", "labelEn"], additionalProperties: false, properties: { labelKo: { type: "string", minLength: 1, maxLength: 60 }, labelEn: { type: "string", minLength: 1, maxLength: 60 } } } } } },
        responses: {
          "200": json("{ ok: true }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "404": errorResponse("not_found"),
          "409": errorResponse("operation_conflict"),
        },
      },
      delete: {
        summary: "업무 분류 삭제 (사용 중인 분류는 관리자만 가능)",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: {
          "204": { description: "삭제됨" },
          "404": errorResponse("not_found"),
          "403": errorResponse("forbidden — 사용 중인 분류는 관리자만 삭제 가능"),
        },
      },
    },
    "/admin/domains": {
      get: {
        summary: "도메인 목록과 사용 건수 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: {
          "200": json("{ domains }", { type: "object" }),
          "401": errorResponse("unauthorized"),
        },
      },
      post: {
        summary: "도메인 추가",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["label"], additionalProperties: false, properties: { label: { type: "string", minLength: 1, maxLength: 100 } } } } } },
        responses: {
          "201": json("{ domain }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("operation_conflict — 같은 이름이 이미 있음"),
        },
      },
      patch: {
        summary: "도메인 표시 순서 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["keys"], additionalProperties: false, properties: { keys: { type: "array", items: { type: "string" } } } } } } },
        responses: {
          "200": json("{ ok: true }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("operation_conflict — 목록이 변경됨"),
        },
      },
    },
    "/admin/domains/{key}": {
      parameters: [{ name: "key", in: "path", required: true, schema: { type: "string", maxLength: 64 } }],
      patch: {
        summary: "도메인 이름 또는 고유 팔레트 색상 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", minProperties: 1, additionalProperties: false, properties: { label: { type: "string", minLength: 1, maxLength: 100 }, color: { type: "string", pattern: "^p(?:[0-6][0-9]|7[01])$", description: "72색 도메인 팔레트 키. 다른 도메인과 중복될 수 없습니다." } } } } } },
        responses: {
          "200": json("{ ok: true }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "404": errorResponse("not_found"),
          "409": errorResponse("operation_conflict"),
        },
      },
      delete: {
        summary: "도메인 삭제 (사용 중인 도메인은 관리자만 가능)",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: {
          "204": { description: "삭제됨" },
          "404": errorResponse("not_found"),
          "403": errorResponse("forbidden — 사용 중인 도메인은 관리자만 삭제 가능"),
        },
      },
    },
    "/admin/users/{id}": {
      patch: {
        summary: "사용자 역할 변경",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: { role: { type: "string", enum: ["admin", "editor"] } },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          "200": json("변경됨", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "404": errorResponse("not_found"),
          "409": errorResponse("operation_conflict — 자기 역할 변경 차단"),
        },
      },
    },
    "/admin/users/{id}/sessions": {
      delete: {
        summary: "사용자의 모든 로그인 세션 종료",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": json("종료한 세션 수", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "404": errorResponse("not_found"),
          "409": errorResponse("operation_conflict — 자기 세션 종료 차단"),
        },
      },
    },
    "/keys": {
      get: {
        summary: "API 키 목록 (비밀값은 돌려주지 않는다)",
        responses: { "200": json("키 목록", { type: "array", items: { type: "object" } }) },
      },
      post: {
        summary: "API 키 발급 — 평문 비밀값은 이 응답에서만 볼 수 있다",
        responses: {
          "201": json("glk_<prefix>_<secret>", { type: "object" }),
          "400": errorResponse("validation_failed"),
        },
      },
    },
    "/keys/{id}": {
      delete: {
        summary: "API 키 폐기",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "204": { description: "폐기됨" }, "404": errorResponse("not_found") },
      },
    },
    // R132: SSO 설정 창구. 관리자 세션만 쓸 수 있고 저장된 클라이언트 시크릿은
    // 어떤 응답에도 담기지 않는다(hasClientSecret 불리언만 내려간다).
    "/sso": {
      get: {
        summary: "SSO 설정 조회 — 시크릿 대신 hasClientSecret, IdP에 등록할 redirectUri 포함",
        responses: {
          "200": json("{ sso, redirectUri }", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만"),
        },
      },
      put: {
        summary: "SSO 설정 저장 — clientSecret은 빈 문자열이면 유지, null이면 삭제",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  mode: { type: "string", enum: ["disabled", "oidc", "oauth2", "oauth2-proxy"] },
                  enabled: { type: "boolean" },
                  passwordLoginEnabled: { type: "boolean" },
                  protocol: { type: "string", enum: ["oidc", "oauth2"] },
                  buttonLabel: { type: "string" },
                  issuer: { type: "string" },
                  jwksUri: { type: "string" },
                  authorizationEndpoint: { type: "string" },
                  tokenEndpoint: { type: "string" },
                  userinfoEndpoint: { type: "string" },
                  clientId: { type: "string" },
                  clientSecret: { type: ["string", "null"] },
                  scopes: { type: "array", items: { type: "string" } },
                  tokenAuthMethod: { type: "string", enum: ["client_secret_post", "client_secret_basic"] },
                  baseUrl: { type: "string" },
                  // 회사마다 이름이 달라서(name / displayName / preferred_username)
                  // 후보를 순서대로 받는다 — 값이 있는 첫 후보를 쓴다.
                  subjectClaims: { type: "array", items: { type: "string" } },
                  emailClaims: { type: "array", items: { type: "string" } },
                  nameClaims: { type: "array", items: { type: "string" } },
                  groupClaims: { type: "array", items: { type: "string" } },
                  allowedGroups: { type: "array", items: { type: "string" } },
                  adminGroups: { type: "array", items: { type: "string" } },
                  autoCreate: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("{ sso, redirectUri }", { type: "object" }),
          "400": errorResponse("validation_failed — 켜기에 필요한 값이 비었으면 details.problems"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만"),
        },
      },
    },
    "/sso/discover": {
      post: {
        summary: "OIDC/OAuth 2.0 발견 문서를 읽어 엔드포인트와 JWKS URI를 채운다",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["issuer"],
                properties: {
                  issuer: { type: "string" },
                  protocol: { type: "string", enum: ["oidc", "oauth2"], default: "oidc" },
                },
              },
            },
          },
        },
        responses: {
          "200": json("{ discovery }", { type: "object" }),
          "400": errorResponse("validation_failed — 발견 문서를 읽지 못함"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만"),
        },
      },
    },
    "/sso/proxy-check": {
      get: {
        summary: "관리자 요청에 실제 도착한 OAuth2-proxy 헤더와 신뢰 상태 확인",
        security: [{ sessionCookie: [] }],
        responses: {
          "200": json("{ proxyHeaders: { authMode, trusted, detected, headerNames, identity } }", {
            type: "object",
          }),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 관리자만"),
        },
      },
    },
    "/contributions/review-queue": {
      get: {
        summary: "AI 작업의 상태와 용어 목록 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["all", "attention", "active", "ready", "failed"], default: "all" } },
          { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
        ],
        responses: {
          "200": json("AI 작업 건수와 필터링된 항목", { type: "object" }),
          "401": errorResponse("unauthorized"),
        },
      },
      post: {
        summary: "AI 작업을 요청하거나 대기 작업을 재개",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          oneOf: [
            {
              type: "object",
              required: ["action"],
              additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["resume"] },
              },
            },
            {
              type: "object",
              required: ["termId", "revision"],
              additionalProperties: false,
              properties: {
                termId: { type: "string", format: "uuid" },
                revision: { type: "integer", minimum: 1 },
              },
            },
            {
              type: "object",
              required: ["items"],
              additionalProperties: false,
              properties: {
                items: {
                  type: "array",
                  minItems: 1,
                  maxItems: 60,
                  items: {
                    type: "object",
                    required: ["termId", "revision"],
                    additionalProperties: false,
                    properties: {
                      termId: { type: "string", format: "uuid" },
                      revision: { type: "integer", minimum: 1 },
                    },
                  },
                },
              },
            },
          ],
        } } } },
        responses: {
          "202": json("검토 큐 등록됨", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("operation_conflict 또는 revision_conflict"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
    },
    "/contributions/term-definitions": {
      get: {
        summary: "본문은 있고 한줄 정의가 없는 용어의 LLM 검토 대기열 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: {
          "200": json("{ items, total }", { type: "object" }),
          "401": errorResponse("unauthorized"),
        },
      },
      post: {
        summary: "용어 본문을 근거로 한줄 정의 제안을 생성하고 리비전별로 캐시",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId"],
          additionalProperties: false,
          properties: { termId: { type: "string", format: "uuid" }, force: { type: "boolean", default: false } },
        } } } },
        responses: {
          "200": json("{ suggestion }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "409": errorResponse("ai_not_enabled 또는 operation_conflict"),
          "422": errorResponse("본문 근거 부족"),
          "502": errorResponse("ai_provider_error"),
        },
      },
      patch: {
        summary: "한줄 정의 한 건 승인",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "definitionMd", "expectedRevision"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            definitionMd: { type: "string", minLength: 1, maxLength: 1000 },
            expectedRevision: { type: "integer", minimum: 1 },
          },
        } } } },
        responses: {
          "200": json("승인 결과", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("revision_conflict 또는 operation_conflict"),
        },
      },
    },
    "/contributions/classifications": {
      post: {
        summary: "비어 있는 도메인 또는 업무 분류의 AI 추천 생성",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "kind", "expectedRevision"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["domain", "category"] },
            expectedRevision: { type: "integer", minimum: 1 },
            force: { type: "boolean", default: false, description: "승인 전 저장된 동일 리비전 추천을 무시하고 다시 생성" },
          },
        } } } },
        responses: {
          "200": json("{ suggestion } 또는 근거가 부족하면 suggestion=null", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("revision_conflict 또는 operation_conflict"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
    },
    "/contributions/identity-review": {
      post: {
        summary: "대표명·확장명·추가 표기의 AI 정비 제안 생성",
        description: "현재 용어의 대표 영문·국문, 영문·국문 확장명, 별칭·약어·표기 종류를 용어집 근거와 비교합니다. 약어와 영문 확장명의 머리글자 대응은 규칙으로 판정하지 않으며, nameKo는 공식 국문 표기가 있을 때만, fullNameKo는 국문 대표명이 약어일 때만 제안합니다. 제안은 저장하지 않으며 사람의 승인 전까지 현재 값을 보존합니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "expectedRevision"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            expectedRevision: { type: "integer", minimum: 1 },
            force: { type: "boolean", default: false, description: "승인 전 저장된 동일 리비전 제안을 무시하고 다시 생성" },
          },
        } } } },
        responses: {
          "200": json("{ review }: 표기 정비 findings, suggestions, uncertainties", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("revision_conflict"),
          "502": errorResponse("ai_provider_error"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
      patch: {
        summary: "AI 표기 정비 제안 승인",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "revision", "suggestionId"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            revision: { type: "integer", minimum: 1 },
            suggestionId: { type: "string", minLength: 1, maxLength: 300 },
            value: { description: "사람이 수정한 문자열 또는 추가 표기 객체(선택)" },
          },
        } } } },
        responses: {
          "200": json("{ ok, revision, review, candidate }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "409": errorResponse("revision_conflict 또는 operation_conflict"),
        },
      },
      delete: {
        summary: "AI 표기 정비 제안 거절",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "revision", "suggestionId"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            revision: { type: "integer", minimum: 1 },
            suggestionId: { type: "string", minLength: 1, maxLength: 300 },
          },
        } } } },
        responses: {
          "204": { description: "제안이 거절됨" },
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "409": errorResponse("operation_conflict"),
        },
      },
    },
    "/contributions/suggestion-dispositions": {
      post: {
        summary: "AI 제안의 공용 숨김·보류 또는 개인 저장 상태 기록",
        description: "dismissed와 deferred는 현재 생성기 버전의 공용 판단으로 저장하고, saved는 로그인한 사용자만 개인 작업으로 저장합니다. 용어 리비전이 바뀌면 상태는 적용되지 않습니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "revision", "feature", "suggestionId", "generatorVersion", "disposition"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            revision: { type: "integer", minimum: 1 },
            feature: { type: "string", enum: ["agent", "identity", "definition", "classification", "duplicate"] },
            suggestionId: { type: "string", minLength: 1, maxLength: 300 },
            generatorVersion: { type: "integer", minimum: 1 },
            disposition: { type: "string", enum: ["dismissed", "deferred", "saved"] },
            reason: { type: "string", maxLength: 500 },
            payload: { type: "object", additionalProperties: true },
          },
        } } } },
        responses: {
          "200": json("{ ok, decision }: 저장된 상태의 id, disposition, scope", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("revision_conflict 또는 operation_conflict"),
        },
      },
      delete: {
        summary: "내 작업에서 AI 제안 제거",
        description: "개인 저장(saved) 상태만 해당 사용자 본인이 제거할 수 있습니다. 제거하면 원래 AI 작업 목록에서 다시 검토할 수 있습니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["decisionId"],
          additionalProperties: false,
          properties: { decisionId: { type: "string", format: "uuid" } },
        } } } },
        responses: {
          "204": { description: "내 작업에서 제거됨" },
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "409": errorResponse("operation_conflict"),
        },
      },
    },
    "/contributions/duplicates": {
      get: {
        summary: "중복 후보 쌍 및 검토 상태 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 }, description: "페이지당 30개" },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "uncertain", "different", "all"], default: "pending" }, description: "검토 상태 필터" },
        ],
        responses: { "200": json("{ items, page, counts }: 후보 쌍은 left/right와 signals, decision, 양쪽 revision을 포함", { type: "object" }), "401": errorResponse("unauthorized") },
      },
      post: {
        summary: "기존 용어 또는 가져오기 행의 동일 개념 AI 검토",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", oneOf: [
          { required: ["termId"], properties: { termId: { type: "string", format: "uuid" }, candidateId: { type: "string", format: "uuid", description: "특정 후보 쌍만 비교" } } },
          { required: ["source"], properties: { source: { type: "object", required: ["id"], description: "id, nameEn, nameKo, fullNameEn, fullNameKo, definitionMd, bodyMd, domain" }, candidates: { type: "array", maxItems: 30, items: { type: "object" } } } },
        ] } } } },
        responses: { "200": json("{ source, revision, candidates }: 각 후보는 verdict(same/different/uncertain), reason, revision을 포함", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "404": errorResponse("term_not_found"), "409": errorResponse("AI 검토 실패"), "413": errorResponse("payload_too_large") },
      },
      patch: {
        summary: "두 용어 병합 또는 후보 쌍 결정 저장",
        description: "병합은 표기·분류·설명을 보존하고 원본은 이력과 함께 보관합니다. 분리·보류 결정은 양쪽 리비전과 함께 저장하며 리비전이 바뀌면 다시 검토합니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", oneOf: [
          { additionalProperties: false, required: ["sourceId", "targetId", "sourceRevision", "targetRevision"], properties: {
            sourceId: { type: "string", format: "uuid" }, targetId: { type: "string", format: "uuid" }, sourceRevision: { type: "integer", minimum: 1 }, targetRevision: { type: "integer", minimum: 1 },
          } },
          { additionalProperties: false, required: ["action", "leftId", "rightId", "leftRevision", "rightRevision", "decision"], properties: {
            action: { type: "string", enum: ["decide"] }, leftId: { type: "string", format: "uuid" }, rightId: { type: "string", format: "uuid" }, leftRevision: { type: "integer", minimum: 1 }, rightRevision: { type: "integer", minimum: 1 }, decision: { type: "string", enum: ["different", "uncertain"] }, reason: { type: "string", maxLength: 1000 },
          } },
        ] } } } },
        responses: { "200": json("병합 결과 또는 { decision }", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "409": errorResponse("operation_conflict") },
      },
    },
    "/contributions/suggestions": {
      get: {
        summary: "현재 용어 리비전에 미리 생성된 AI 검토 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        parameters: [
          { name: "termId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "revision", in: "query", required: true, schema: { type: "integer", minimum: 1 } },
        ],
        responses: {
          "200": json("준비된 제안", { type: "object" }),
          "202": json("아직 생성 중", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "409": errorResponse("revision_conflict"),
        },
      },
      patch: {
        summary: "AI가 제안한 용어 관계 승인 또는 거절",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "revision", "suggestionId", "decision"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            revision: { type: "integer", minimum: 1 },
            suggestionId: { type: "string", minLength: 1, maxLength: 200 },
            decision: { type: "string", enum: ["approved", "rejected"] },
          },
        } } } },
        responses: {
          "204": { description: "관계 제안 처리됨" },
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "409": errorResponse("operation_conflict"),
        },
      },
      delete: {
        summary: "자동 생성된 제안 거절",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["termId", "revision", "suggestionId"],
          additionalProperties: false,
          properties: {
            termId: { type: "string", format: "uuid" },
            revision: { type: "integer", minimum: 1 },
            suggestionId: { type: "string", minLength: 1, maxLength: 200 },
          },
        } } } },
        responses: {
          "204": { description: "거절됨" },
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "409": errorResponse("operation_conflict"),
        },
      },
    },
    "/chat": {
      get: {
        summary: "내 챗봇 대화 세션 목록과 선택한 대화 조회",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "session", in: "query", schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": json("최근 대화 세션과 선택한 대화 메시지", { type: "object" }),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("not_found"),
        },
      },
      post: {
        summary: "용어집 근거 질문과 용어 생성·수정안 작성",
        description: "질문·등록·수정·회의록 분석 의도를 구분합니다. 근거 답변에는 주장별 인용과 구절·리비전 스냅샷인 grounded를 반환하며, 회의록 분석에는 사용자 원문 M·용어집 G·위키 W 근거를 연결한 meeting을 반환합니다. 같은 도메인 안에서 최대 2회 검색합니다. 등록은 초안, 수정은 적용 전 edit 제안을 반환합니다. 로그인 세션 응답에는 저장된 messages도 포함되며, API Key(read) 호출은 대화 내용을 저장하지 않습니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["question"],
          additionalProperties: false,
          properties: {
            question: { type: "string", minLength: 1, maxLength: 20000 },
            sessionId: { type: "string", format: "uuid", description: "로그인 사용자가 이어갈 대화 세션" },
            domain: { type: ["string", "null"], minLength: 1, maxLength: 100, description: "검색할 도메인 label. 생략하거나 null이면 전체 도메인" },
            history: { type: "array", maxItems: 8, items: { type: "object", required: ["role", "content"], properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string", minLength: 1, maxLength: 4000 },
            } } },
            teachingDraft: {
              type: ["object", "null"],
              description: "직전 응답의 teaching.draft. 모르는 용어를 이어서 설명할 때 그대로 보냅니다.",
              properties: {
                nameEn: { type: ["string", "null"] },
                nameKo: { type: ["string", "null"] },
                fullNameEn: { type: ["string", "null"] },
                fullNameKo: { type: ["string", "null"] },
                definitionMd: { type: ["string", "null"] },
                bodyMd: { type: ["string", "null"] },
                domain: { type: "array", items: { type: "string" } },
                category: { type: "array", items: { type: "string" } },
                surfaces: { type: "array", items: { type: "object" } },
                skipped: { type: "object" },
              },
            },
          },
        } } } },
        responses: {
          "200": json("근거 답변 또는 teaching/teachingBatch/edit/meeting 결과. edit는 로그인 세션에서만 적용 가능", {
            type: "object", properties: {
              answer: { type: "string" },
              meeting: { type: "object", description: "회의 요약·결정·액션·리스크·인사이트와 M/G 근거. 서버가 근거 ID를 검증한다." },
              grounded: { type: "object", required: ["claims", "insights", "uncertainties", "evidence", "searchedQueries", "domain"], properties: {
                claims: { type: "array", items: { type: "object", required: ["text", "evidenceIds"], properties: {
                  text: { type: "string" }, evidenceIds: { type: "array", minItems: 1, items: { type: "string" } },
                } } },
                insights: { type: "array", maxItems: 8, items: { type: "object", required: ["title", "text", "evidenceIds", "confidence", "discussionQuestion"], properties: {
                  title: { type: "string" }, text: { type: "string" }, evidenceIds: { type: "array", minItems: 1, items: { type: "string" } },
                  confidence: { type: "string", enum: ["high", "medium", "low"] }, discussionQuestion: { type: ["string", "null"] },
                } } },
                uncertainties: { type: "array", items: { type: "string" } },
                searchedQueries: { type: "array", maxItems: 2, items: { type: "string" } },
                domain: { type: ["string", "null"] },
                evidence: { type: "array", items: { type: "object", required: ["id", "slug", "title", "revision", "updatedAt", "field", "excerpt"], properties: {
                  id: { type: "string" }, termId: { type: "string", format: "uuid" }, slug: { type: "string" }, title: { type: "string" },
                  revision: { type: "integer", minimum: 0 }, updatedAt: { type: "string", format: "date-time" },
                  field: { type: "string", enum: ["metadata", "definition", "body", "relationship", "meeting", "wiki"] },
                  source: { type: "string", enum: ["glossary", "meeting", "wiki"] }, meetingDocumentId: { type: "string", format: "uuid" }, meetingDate: { type: ["string", "null"], format: "date-time" },
                  wikiPageId: { type: "string", format: "uuid" }, wikiSlug: { type: "string" },
                  excerpt: { type: "string" }, start: { type: "integer", minimum: 0, description: "원문의 UTF-16 오프셋" }, relatedTerm: { type: "object" },
                } } },
              } },
            },
          }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "429": errorResponse("rate_limited"),
          "502": errorResponse("ai_provider_error"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
      patch: {
        summary: "용어 초안 작업이 반영된 대화 메시지 저장",
        description: "서버에 저장된 edit 수정안·실행 상태와 grounded/meeting 답변·구절·출처는 변경할 수 없습니다. 기존 메시지가 누락되면 409를 반환합니다.",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["sessionId", "messages"],
          additionalProperties: false,
          properties: {
            sessionId: { type: "string", format: "uuid" },
            messages: { type: "array", maxItems: 500, items: { type: "object" } },
          },
        } } } },
        responses: {
          "200": json("저장 완료", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("not_found"),
        },
      },
      delete: {
        summary: "내 챗봇 대화 세션 삭제",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: "session", in: "query", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "삭제됨" },
          "401": errorResponse("unauthorized"),
          "404": errorResponse("not_found"),
        },
      },
    },
    "/chat/actions": {
      post: {
        summary: "내 대화에 저장된 용어 수정안 적용 또는 취소",
        description: "클라이언트는 변경 내용을 보내지 않고 서버의 수정안 ID만 지정합니다. 적용은 리비전 검사 후 용어·이력·완료 기록을 함께 저장합니다. 이미 처리된 요청은 저장된 결과를 반환하며 중복 실행하지 않습니다.",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", additionalProperties: false, required: ["sessionId", "actionId", "action"],
          properties: {
            sessionId: { type: "string", format: "uuid" }, actionId: { type: "string", format: "uuid" },
            action: { type: "string", enum: ["apply", "cancel"] },
          },
        } } } },
        responses: {
          "200": json("처리된 edit 수정안. appliedRevision은 적용된 리비전 번호", { type: "object" }),
          "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden"), "404": errorResponse("not_found 또는 term_not_found"),
          "409": errorResponse("revision_conflict"),
        },
      },
    },
    "/rag/search": {
      post: {
        summary: "용어집 벡터 검색",
        description: "현재 용어 리비전의 pgvector 청크를 Embedding API로 검색하고, 설정된 경우 Cohere-compatible Reranker로 재정렬한다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 1, maxLength: 20000 },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            domain: { type: ["string", "null"], maxLength: 200 },
            rerank: { type: "boolean", description: "생략하면 관리자 설정을 따른다." },
          },
        } } } },
        responses: {
          "200": json("검색 청크와 용어 메타데이터", { type: "object", properties: { query: { type: "string" }, total: { type: "integer" }, items: { type: "array", items: { type: "object" } } } }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "502": errorResponse("rag_provider_error"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/rag/meetings/search": {
      post: {
        summary: "기존 회의 자료 벡터 검색",
        description: "현재 활성 회의록 revision의 pgvector 청크를 Embedding API로 검색하고, 설정된 경우 Reranker로 재정렬한다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 1, maxLength: 20000 },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            domain: { type: ["string", "null"], maxLength: 200 },
            team: { type: ["string", "null"], maxLength: 200 },
            from: { type: ["string", "null"], format: "date-time" },
            to: { type: ["string", "null"], format: "date-time" },
            rerank: { type: "boolean", description: "생략하면 관리자 설정을 따른다." },
          },
        } } } },
        responses: {
          "200": json("회의록 청크 검색 결과", { type: "object", properties: { query: { type: "string" }, total: { type: "integer" }, items: { type: "array", items: { type: "object" } } } }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "502": errorResponse("rag_provider_error"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/rag/wiki/search": {
      post: {
        summary: "공개 위키 벡터 검색",
        description: "현재 published 위키 문서 revision의 pgvector 청크를 Embedding API로 검색하고, 설정된 경우 Reranker로 재정렬한다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["query"],
          additionalProperties: false,
          properties: {
            query: { type: "string", minLength: 1, maxLength: 20000 },
            topK: { type: "integer", minimum: 1, maximum: 50 },
            domain: { type: ["string", "null"], maxLength: 200 },
            rerank: { type: "boolean", description: "생략하면 관리자 설정을 따른다." },
          },
        } } } },
        responses: {
          "200": json("위키 문서 청크와 메타데이터", { type: "object", properties: { query: { type: "string" }, total: { type: "integer" }, items: { type: "array", items: { type: "object" } } } }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "502": errorResponse("rag_provider_error"),
          "503": errorResponse("rag_not_ready"),
        },
      },
    },
    "/wiki": {
      get: {
        summary: "위키 문서 목록·검색",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["draft", "published", "archived"] } },
          { name: "domain", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "termId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": json("위키 문서 목록", { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/WikiPage" } }, total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" } } }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized") },
      },
      post: {
        summary: "위키 문서 생성 및 RAG 색인 예약",
        description: "위키 문서는 초안 또는 공개 상태로 저장할 수 있으며, published 문서만 RAG 색인 대상이 된다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["title", "content"], additionalProperties: false,
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 120 },
            title: { type: "string", minLength: 1, maxLength: 240 },
            summary: { type: ["string", "null"], maxLength: 600 },
            sourceUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 },
            content: { type: "string", minLength: 1, maxLength: 200000 },
            domain: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
            termSlugs: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
            status: { type: "string", enum: ["draft", "published", "archived"] },
          },
        } } } },
        responses: { "201": json("생성된 위키 문서", { type: "object", properties: { page: { allOf: [{ $ref: "#/components/schemas/WikiPage" }, { type: "object", required: ["content"] }] }, indexed: { type: "boolean" } } }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "403": errorResponse("forbidden") },
      },
    },
    "/wiki/{slug}": {
      parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
      get: {
        summary: "위키 문서 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: { "200": json("위키 문서 원문과 연결 용어", { type: "object", properties: { page: { allOf: [{ $ref: "#/components/schemas/WikiPage" }, { type: "object", required: ["content"] }] } } }), "401": errorResponse("unauthorized"), "404": errorResponse("not_found") },
      },
      patch: {
        summary: "위키 문서 수정 및 RAG 색인 예약",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", additionalProperties: false,
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 120 }, title: { type: "string", minLength: 1, maxLength: 240 },
            summary: { type: ["string", "null"], maxLength: 600 }, sourceUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 }, content: { type: "string", minLength: 1, maxLength: 200000 },
            domain: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
            termSlugs: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } }, status: { type: "string", enum: ["draft", "published", "archived"] },
          },
        } } } },
        responses: { "200": json("수정된 위키 문서", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "403": errorResponse("forbidden"), "404": errorResponse("not_found") },
      },
    },
    "/meetings": {
      get: {
        summary: "기존 회의 자료 목록",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "archived"] } },
          { name: "domain", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "team", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": json("회의록 메타데이터 목록", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized") },
      },
      post: {
        summary: "기존 연동 호환용 회의 자료 저장 및 RAG 색인 예약",
        description: "원문은 revision 1로 저장되고 Embedding 색인 대기열에 들어간다. 자동 저장하지 않으며 명시적 write 권한이 필요하다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["title", "content"], additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 240 },
            meetingDate: { type: ["string", "null"], format: "date-time" },
            source: { type: "string", maxLength: 200 }, team: { type: "string", maxLength: 200 },
            domain: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
            content: { type: "string", minLength: 1, maxLength: 200000 },
          },
        } } } },
        responses: { "201": json("저장된 기존 회의 자료", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "403": errorResponse("forbidden") },
      },
    },
    "/meetings/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        summary: "기존 회의 자료 원문 조회",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        responses: { "200": json("회의록 원문과 메타데이터", { type: "object" }), "401": errorResponse("unauthorized"), "404": errorResponse("not_found") },
      },
      patch: {
        summary: "기존 회의 자료 수정 또는 보관",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 240 }, meetingDate: { type: ["string", "null"], format: "date-time" },
            source: { type: "string", maxLength: 200 }, team: { type: "string", maxLength: 200 },
            domain: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
            content: { type: "string", minLength: 1, maxLength: 200000 }, status: { type: "string", enum: ["active", "archived"] },
          },
        } } } },
        responses: { "200": json("수정된 회의록", { type: "object" }), "400": errorResponse("validation_failed"), "401": errorResponse("unauthorized"), "403": errorResponse("forbidden"), "404": errorResponse("not_found") },
      },
    },
    "/terms": {
      get: {
        summary: "용어 목록·검색",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "domain", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: businessCategorySchema },
          { name: "topic", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: statusSchema },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": json("목록", { type: "object" }), "400": errorResponse("validation_failed") },
      },
      post: {
        summary: "용어 등록",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  qualityProfile: termQualityProfileSchema,
                  nameEn: { type: ["string", "null"] },
                  nameKo: { type: ["string", "null"] },
                  fullNameEn: { type: ["string", "null"] },
                  fullNameKo: { type: ["string", "null"] },
                  definitionMd: { type: ["string", "null"] },
                  bodyMd: { type: ["string", "null"] },
                  domain: { type: "array", items: { type: "string" } },
                  category: businessCategoriesSchema,
                  topic: { type: ["string", "null"] },
                  ownerId: { type: ["string", "null"], format: "uuid" },
                  status: statusSchema,
                  surfaces: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          // 대표 영문·국문 표기 중복은 400으로 막는다. 추가 표기 중복은 기존처럼
          // 생성 결과의 warnings로 돌려 동음이의어 검토 경로를 남긴다.
          "201": json("{ term, surfaces, warnings }", { type: "object" }),
          "400": errorResponse("validation_failed"),
        },
      },
    },
    "/terms/{idOrSlug}": {
      parameters: [{ name: "idOrSlug", in: "path", required: true, schema: { type: "string" } }],
      get: {
        summary: "용어 상세",
        responses: {
          "200": json("상세", { $ref: "#/components/schemas/TermDetail" }),
          "404": errorResponse("not_found"),
        },
      },
      patch: {
        summary: "용어 수정 (낙관적 잠금)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  // R109: 편집 화면이 읽은 리비전 번호. 그 사이 남이 고쳤으면 409다.
                  expectedRevision: { type: "integer" },
                  slug: {
                    type: "string",
                    description: "새 URL slug. 서버가 소문자·하이픈 형식으로 정규화한다.",
                    maxLength: 160,
                  },
                  message: { type: "string" },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          "200": json("{ term, surfaces, warnings }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "404": errorResponse("not_found"),
          "409": errorResponse("revision_conflict 또는 slug_conflict"),
        },
      },
      delete: {
        summary: "용어 삭제 (admin 전용)",
        responses: {
          "204": { description: "삭제됨" },
          "403": errorResponse("forbidden"),
          "404": errorResponse("not_found"),
        },
      },
    },
    "/terms/{idOrSlug}/ai-review": {
      post: {
        summary: "저장 전 용어 초안을 AI로 검토",
        parameters: [{ name: "idOrSlug", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["term"],
                additionalProperties: false,
                properties: {
                  term: { type: "object" },
                  instruction: { type: "string", maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          "200": json("AI 검토 결과", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "404": errorResponse("term_not_found"),
          "502": errorResponse("ai_provider_error"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
    },
    "/terms/{idOrSlug}/revisions": {
      get: {
        summary: "수정 이력 (최신순)",
        parameters: [{ name: "idOrSlug", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": json("리비전 목록", { type: "array", items: { type: "object" } }),
          "404": errorResponse("not_found"),
        },
      },
    },
    "/terms/{idOrSlug}/revisions/{number}/revert": {
      post: {
        summary: "지정한 리비전의 내용으로 되돌린다",
        description:
          "이력을 지우지 않는다 — 대상 리비전의 스냅샷을 현재 상태에 덮어쓰는 새 리비전을 남긴다. " +
          "expectedRevision을 보내면 PATCH와 같은 낙관적 동시성 제어를 받는다.",
        parameters: [
          { name: "idOrSlug", in: "path", required: true, schema: { type: "string" } },
          { name: "number", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { expectedRevision: { type: "integer", minimum: 1 } },
              },
            },
          },
        },
        responses: {
          "200": json("{ term, surfaces, warnings }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "404": errorResponse("not_found"),
          "409": errorResponse("revision_conflict"),
        },
      },
    },
    "/import": {
      post: {
        summary: "엑셀(xlsx) 용어집을 dry-run으로 검사하거나 실제로 반영한다",
        description:
          "dryRun 필드를 보내지 않으면 dry-run이 기본이다 — 실수로 반영되지 않게 한 것이다. " +
          "실제 반영은 dryRun=false를 명시해야 한다. 본문은 10MB까지 받는다.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                  dryRun: {
                    type: "string",
                    enum: ["true", "false"],
                    description: "생략하면 dry-run이다. 실제 반영은 \"false\"를 명시해야 한다.",
                  },
                  force: {
                    type: "string",
                    description:
                      "충돌·중복으로 걸린 행 중 그래도 등록할 행 번호를 쉼표로 나열한다(동음이의어 강제 등록).",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": json("dry-run이면 { dryRun: true, report }, 반영이면 { dryRun: false, created, skipped, ... }", {
            type: "object",
          }),
          "400": errorResponse("validation_failed — multipart가 아니거나, file이 없거나, 행 수 상한 초과"),
          "401": errorResponse("unauthorized"),
          "413": errorResponse("payload_too_large — 10MB 초과"),
        },
      },
    },
    "/import/review": {
      post: {
        summary: "영문·한글 용어집의 표기 분리를 검토하고 승인된 행을 가져온다",
        description: "영문·한글 두 열은 필수이며 도메인, 한줄 정의, 본문은 선택합니다. 최대 5000행, 파일·텍스트·검토 데이터 각각 10MB입니다. apply=true일 때만 저장하며 원본으로 재검사하여 변경된 승인과 미검토 행이 있으면 저장하지 않습니다.",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: {
            type: "object",
            required: ["review"],
            anyOf: [{ required: ["file"] }, { required: ["text"] }],
            properties: {
              file: { type: "string", format: "binary", description: "xlsx 파일. text와 함께 보내면 파일을 사용합니다." },
              text: { type: "string", description: "엑셀에서 복사한 탭 구분 표" },
              hasHeaders: { type: "string", enum: ["true", "false"], description: "헤더 없는 텍스트의 열 순서는 영문, 한글, 선택한 도메인·한줄 정의·본문 순입니다." },
              review: { type: "string", description: "JSON 문자열: columns는 domain/definitionMd/bodyMd 배열(기본 []), options는 comma/semicolon/newline 불리언, decisions는 rowNumber/en 배열/ko 배열/skip/선택적 approval을 가진 행 배열입니다. approval에는 미리보기의 fingerprint를 전달합니다. mergeIntoRow는 파일 내 대표 행 번호, mergeIntoTerm은 기존 대표 용어의 {id, revision}입니다. 동시에 지정하거나 병합 체인을 만들 수 없으며 선택 후 재검사·승인이 필요합니다." },
              apply: { type: "string", enum: ["true", "false"], default: "false" },
            },
          } } },
        },
        responses: {
          "200": json("미리보기는 { report }, 미검토는 { report, needsReview: true }, 저장은 { report, completed, failures, created }. 일부 저장 후 실패할 수 있으므로 재시도 시 completed 행은 제외해야 합니다.", { type: "object" }),
          "400": errorResponse("validation_failed — 입력 형식 또는 검토 데이터 오류"),
          "401": errorResponse("unauthorized"),
          "403": errorResponse("forbidden — 쓰기 권한 필요"),
          "413": errorResponse("payload_too_large"),
        },
      },
    },
    "/terms/paste-check": {
      post: {
        summary: "시트 붙여넣기 전체 사전 검사",
        description: "기존 행 수정과 새 행 생성을 실제 저장하기 전에 검증하고 발견한 오류를 모두 반환합니다.",
        security: [{ sessionCookie: [] }, { apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["updates", "creates"],
          additionalProperties: false,
          properties: {
            updates: { type: "array", maxItems: 200, items: { type: "object" } },
            creates: { type: "array", maxItems: 200, items: { type: "object" } },
          },
        } } } },
        responses: {
          "200": json("{ ok, errors[] }", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
        },
      },
    },
    "/attachments": {
      post: {
        summary: "본문 이미지 업로드 및 WebP 변환",
        description: "PNG/JPEG/WebP 원본을 받아 긴 변 2560px 이하의 WebP로 변환하고 내용 해시 URL을 반환한다.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          "200": json("이미 존재하는 동일 이미지", { type: "object" }),
          "201": json("{ sha256, url, mime, byteSize, width, height, originalFilename }", { type: "object" }),
          "400": errorResponse("validation_failed — 지원하지 않거나 손상된 이미지"),
          "401": errorResponse("unauthorized"),
          "413": errorResponse("payload_too_large — 원본 10MB 또는 변환 결과 2MB 초과"),
        },
      },
    },
    "/attachments/{sha256}": {
      get: {
        summary: "내용 해시로 첨부 이미지 조회",
        parameters: [{ name: "sha256", in: "path", required: true, schema: { type: "string", pattern: "^[a-f0-9]{64}$" } }],
        responses: {
          "200": { description: "WebP 이미지", content: { "image/webp": { schema: { type: "string", format: "binary" } } } },
          "304": { description: "ETag가 일치함" },
          "401": errorResponse("unauthorized"),
          "404": errorResponse("not_found"),
        },
      },
    },
    "/terms/suggest": {
      get: {
        summary: "검색창 자동완성 — 앞부분이 맞거나 비슷한 표기 (최대 8개)",
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          // 각 항목의 prefix=true는 "입력이 이 표기의 앞부분"(자동완성),
          // false는 "비슷하기만 함"(오타 교정 후보)이다.
          "200": json("{ items: [{ slug, matchedText, matchedKind, exact, prefix, ... }] }", { type: "object" }),
          "400": errorResponse("validation_failed — q가 없거나 비어 있다"),
          "401": errorResponse("unauthorized"),
        },
      },
    },
    "/terms/lookup": {
      post: {
        summary: "문서에 쓰인 표기들이 등록된 용어인지 한 번에 확인한다 (AI-Lint 통합 지점)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["texts"],
                properties: { texts: { type: "array", items: { type: "string" } } },
              },
            },
          },
        },
        responses: {
          "200": json("표기별 매칭 결과와 유사 후보", { type: "object" }),
          "400": errorResponse("validation_failed"),
        },
      },
    },
  },
};
