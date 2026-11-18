/**
 * AI 운영 화면에 보이는 작업·오류 이름. 텔레메트리는 기계용 식별자(`chat.intent`)를
 * 그대로 저장하고, 사람이 읽는 이름은 여기서만 붙인다 — 저장값을 한글로 바꾸면
 * 과거 기록과 새 기록이 같은 작업인데 다른 행으로 집계된다.
 */
const OPERATION_LABEL: Record<string, string> = {
  "agent.definition": "한줄 정의 제안",
  "agent.duplicate": "중복 용어 판정",
  "agent.edit-review": "수정 제안 검토",
  "agent.identity-review": "동일 개념 검토",
  "agent.review": "용어 자동 검토",
  "chat.edit.propose": "챗봇 수정 제안",
  "chat.edit.select": "챗봇 수정 대상 선택",
  "chat.grounded-answer": "챗봇 답변",
  "chat.intent": "챗봇 질문 분류",
  "chat.meeting-analysis": "회의록 분석",
  "chat.paste-extraction": "붙여넣기 용어 추출",
  "chat.research.plan": "챗봇 조사 계획",
  "chat.teaching": "챗봇 용어 등록안",
  "discovery.critique": "발견 가설 비평",
  "discovery.curate_relations": "관계 후보 정리",
  "discovery.generate": "발견 가설 생성",
  "discovery.verify": "발견 가설 검증",
  "rag.embedding.index": "용어 색인 Embedding",
  "rag.embedding.meeting-index": "회의록 색인 Embedding",
  "rag.embedding.meeting-query": "회의록 검색 Embedding",
  "rag.embedding.query": "용어 검색 Embedding",
  "rag.embedding.wiki-index": "위키 색인 Embedding",
  "rag.embedding.wiki-query": "위키 검색 Embedding",
  "rag.reranker.meeting-query": "회의록 검색 Reranker",
  "rag.reranker.query": "용어 검색 Reranker",
  "rag.reranker.wiki-query": "위키 검색 Reranker",
};

const ERROR_CODE_LABEL: Record<string, string> = {
  authentication: "인증 실패",
  model_not_found: "모델 없음",
  rate_limited: "호출 한도 초과",
  provider_request: "요청 거부",
  provider_unavailable: "공급자 오류",
  timeout: "시간 초과",
  network: "네트워크 오류",
  truncated: "응답 잘림",
  invalid_response: "응답 형식 오류",
  internal: "내부 오류",
  cancelled: "요청자 중단",
  stale_run: "응답 없이 종료",
};

export function operationLabel(operation: string): string {
  // `.repair`는 형식이 어긋난 첫 응답을 고쳐 달라는 두 번째 호출이다. 따로 이름을
  // 두면 표에서 같은 작업이 두 줄로 흩어져 보이므로 원래 작업에 표시만 붙인다.
  const repair = operation.endsWith(".repair");
  const base = repair ? operation.slice(0, -".repair".length) : operation;
  const label = OPERATION_LABEL[base];
  if (!label) return operation;
  return repair ? `${label} (형식 보정)` : label;
}

export function errorCodeLabel(code: string | null): string {
  if (!code) return "실패";
  return ERROR_CODE_LABEL[code] ?? code;
}
