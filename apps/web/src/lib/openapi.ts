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

const termTypeSchema = {
  type: "string",
  enum: ["concept", "proper_name", "identifier", "unit"],
};
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
    enum: ["draft", "active", "deprecated", "forbidden"],
    description: "draft는 공동 작성 중이며 기본 목록·검색·추천·lookup에서 제외됩니다. active는 팀 공개 및 사용 가능 상태입니다.",
  };

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Grossary 용어집 API",
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
      sessionCookie: { type: "apiKey", in: "cookie", name: "grossary_session" },
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
        required: ["id", "slug", "termType", "qualityProfile", "domain", "categories", "categoryLabels", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          termType: termTypeSchema,
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
    },
  },
  paths: {
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
          "200": json("grossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
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
          "200": json("grossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
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
          "200": json("계정을 만들고 grossary_session 쿠키를 Set-Cookie로 내려준다", { type: "object" }),
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
        summary: "저장하지 않고 AI 활용 기준 변경 영향을 미리 계산",
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
          required: ["enabled", "provider", "baseUrl", "model", "customHeaders"],
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
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
        summary: "도메인 이름 변경",
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["label"], additionalProperties: false, properties: { label: { type: "string", minLength: 1, maxLength: 100 } } } } } },
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
                  enabled: { type: "boolean" },
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
    "/chat": {
      post: {
        summary: "용어집에 근거한 AI 질문",
        description: "질문과 최근 대화에서 관련 용어를 검색한 뒤, 관리자가 연결한 AI에 해당 용어 맥락만 전달합니다.",
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["question"],
          additionalProperties: false,
          properties: {
            question: { type: "string", minLength: 1, maxLength: 4000 },
            history: { type: "array", maxItems: 8, items: { type: "object", required: ["role", "content"], properties: {
              role: { type: "string", enum: ["user", "assistant"] },
              content: { type: "string", minLength: 1, maxLength: 4000 },
            } } },
          },
        } } } },
        responses: {
          "200": json("용어집 근거 답변과 출처 용어", { type: "object" }),
          "400": errorResponse("validation_failed"),
          "401": errorResponse("unauthorized"),
          "429": errorResponse("rate_limited"),
          "502": errorResponse("ai_provider_error"),
          "503": errorResponse("ai_not_enabled"),
        },
      },
    },
    "/terms": {
      get: {
        summary: "용어 목록·검색",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: termTypeSchema },
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
                required: ["termType"],
                properties: {
                  termType: termTypeSchema,
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
