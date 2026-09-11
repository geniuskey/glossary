import { RELATION_TYPES } from "./relation-values";
const uuid = { type: "string", format: "uuid" };
const revision = { type: "integer", minimum: 1 };
const nullableRevision = { type: ["integer", "null"], minimum: 1 };
const relationType = { type: "string", enum: RELATION_TYPES };
const evidence = { type: "string", minLength: 1, maxLength: 4000 };
const version = { type: "string", maxLength: 20, pattern: "^[0-9]+$", description: "조회한 관계의 불투명 동시성 토큰. 수정·검토 시 그대로 전달합니다." };
const term = { type: "object", required: ["id", "slug", "name", "definition", "domain", "revision"], properties: {
  id: uuid, slug: { type: "string" }, name: { type: "string" }, definition: { type: ["string", "null"] }, domain: { type: "array", items: { type: "string" } }, revision: { type: "integer", minimum: 0 },
} };
const relation = { type: "object", required: ["id", "sourceTermId", "targetTermId", "relationType", "status", "evidenceMd", "source", "target", "stale", "version"], properties: {
  id: uuid, sourceTermId: uuid, targetTermId: uuid, relationType, evidenceMd: { type: ["string", "null"] },
  status: { type: "string", enum: ["proposed", "approved", "rejected"] }, confidence: { type: "integer", minimum: 0, maximum: 100 },
  sourceRevision: nullableRevision, targetRevision: nullableRevision, source: term, target: term, stale: { type: "boolean" }, version,
  reviewedBy: { type: ["string", "null"], format: "uuid" }, reviewerName: { type: ["string", "null"] }, reviewedAt: { type: ["string", "null"], format: "date-time" },
} };
const json = (schema: object) => ({ "application/json": { schema } });
const error = (description: string) => ({ description, content: json({ $ref: "#/components/schemas/Error" }) });
const errors = { "400": error("validation_failed"), "401": error("unauthorized"), "403": error("forbidden"), "404": error("not_found"), "409": error("revision_conflict / operation_conflict"), "500": error("internal_error") };
const fields = { relationType, evidenceMd: evidence, sourceRevision: revision, targetRevision: revision };
const idResponse = { type: "object", required: ["id"], properties: { id: uuid } };

export const relationPaths = {
  "/relations": {
    get: {
      summary: "의미 관계 목록과 최신 정의·재검토 상태 조회", description: "페이지당 20개. 상태 생략 시 승인·제안·거절을 모두 조회합니다. 읽기 API 키 또는 로그인 세션이 필요합니다.",
      parameters: [
        { name: "termId", in: "query", schema: uuid },
        { name: "status", in: "query", schema: { type: "string", enum: ["proposed", "approved", "rejected"] } },
        { name: "type", in: "query", schema: relationType },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
      ], responses: { "200": { description: "관계 목록", content: json({ type: "object", required: ["items", "total", "page"], properties: { items: { type: "array", items: relation }, total: { type: "integer" }, page: { type: "integer" } } }) }, ...errors },
    },
    post: {
      summary: "의미 관계 제안", description: "로그인한 사용자 전용. proposed로 저장됩니다. 양쪽 용어의 조회 당시 리비전이 필요하며 동일 출발·도착·종류 중복은 409입니다.", security: [{ sessionCookie: [] }],
      requestBody: { required: true, content: json({ type: "object", additionalProperties: false, required: ["sourceTermId", "targetTermId", ...Object.keys(fields)], properties: { sourceTermId: uuid, targetTermId: uuid, ...fields } }) },
      responses: { "201": { description: "제안 생성", content: json(idResponse) }, ...errors },
    },
  },
  "/relations/{id}": {
    patch: {
      summary: "관계 수정·승인·거절", security: [{ sessionCookie: [] }],
      description: "로그인한 사용자 전용. edit는 최신 정의의 리비전과 근거를 저장하고 proposed로 되돌립니다. approved는 오래되지 않은 proposed만 승인합니다. rejected는 승인 철회에도 사용하며 물리 삭제하지 않습니다. 모든 작업에 조회한 version이 필요합니다.",
      parameters: [{ name: "id", in: "path", required: true, schema: uuid }],
      requestBody: { required: true, content: json({ oneOf: [
        { type: "object", additionalProperties: false, required: ["action", "version", ...Object.keys(fields)], properties: { action: { const: "edit" }, version, ...fields } },
        { type: "object", additionalProperties: false, required: ["action", "version"], properties: { action: { type: "string", enum: ["approved", "rejected"] }, version } },
      ] }) }, responses: { "200": { description: "관계 변경", content: json(idResponse) }, ...errors },
    },
  },
  "/relations/terms": {
    get: {
      summary: "관계 편집용 용어 검색", description: "표기·약어 검색 결과 최대 20개와 정의·리비전을 반환합니다.",
      parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 1, maxLength: 200 } }],
      responses: { "200": { description: "용어 후보", content: json({ type: "object", properties: { items: { type: "array", items: term }, total: { type: "integer" } } }) }, ...errors },
    },
  },
};
