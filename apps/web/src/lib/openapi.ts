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
  enum: ["draft", "approved", "deprecated", "forbidden"],
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
