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
  enum: ["term", "abbreviation", "project", "product_id", "code", "unit"],
};
const statusSchema = {
  type: "string",
  enum: ["active", "deprecated", "forbidden"],
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Grossary 용어집 API",
    version: "1.0.0",
    description:
      "센서 제품군 용어집. 사내망 온프레미스 배포이며 평문 HTTP로 동작할 수 있다 " +
      "(docs/operations.md 참조). 모든 에러 응답은 { error: { code, message, details? } } 형태다.",
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
        required: ["id", "slug", "termType", "domain", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          slug: { type: "string" },
          termType: termTypeSchema,
          nameEn: { type: ["string", "null"] },
          nameKo: { type: ["string", "null"] },
          domain: { type: "array", items: { type: "string" } },
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
                  buttonLabel: { type: "string" },
                  issuer: { type: "string" },
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
        summary: "issuer의 /.well-known/openid-configuration을 읽어 엔드포인트를 채운다",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["issuer"], properties: { issuer: { type: "string" } } },
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
    "/terms": {
      get: {
        summary: "용어 목록·검색",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: termTypeSchema },
          { name: "domain", in: "query", schema: { type: "string" } },
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
                  nameEn: { type: ["string", "null"] },
                  nameKo: { type: ["string", "null"] },
                  fullNameEn: { type: ["string", "null"] },
                  fullNameKo: { type: ["string", "null"] },
                  definitionMd: { type: ["string", "null"] },
                  bodyMd: { type: ["string", "null"] },
                  domain: { type: "array", items: { type: "string" } },
                  status: statusSchema,
                  surfaces: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          // warnings는 중복 후보다. 저장은 이미 끝난 상태로 내려온다 — 동음이의어를
          // 허용하는 설계라 서버가 막지 않는다.
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
          "409": errorResponse("revision_conflict — details.currentRevision에 현재 번호가 있다"),
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
