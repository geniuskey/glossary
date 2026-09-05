# AI 연결과 챗봇 API

AI 연결과 작성 기준 설정은 관리자 세션만 사용할 수 있다. 실제 챗봇 질문은 로그인
세션 또는 `read` scope API Key가 필요하다. 경로는 모두 `/api/v1` 기준이다.

## AI 연결 설정

### `GET /admin/ai-config`

저장된 연결을 반환한다. API Key 평문은 포함하지 않으며 `hasApiKey`로 존재 여부만,
custom header는 이름과 `configured` 상태만 보여준다.

### `PATCH /admin/ai-config`

```json
{
  "enabled": true,
  "autoReviewEnabled": true,
  "provider": "gemini",
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
  "model": "gemini-3.6-flash",
  "apiKey": "...",
  "customHeaders": []
}
```

`autoReviewEnabled`를 켜면 정리 대기 용어와 검색된 기존 용어 근거가 설정한 AI 공급자에
전달될 수 있으며, 생성된 수정 제안은 사용자가 승인하기 전까지 원문에 반영되지 않는다.

`provider`는 `gemini` 또는 `openai_compatible`이다. API Key를 생략하거나 빈 문자열로
보내면 기존 값을 유지하고, `null`이면 삭제한다. 저장된 custom header 값도 화면에서
받은 빈 값과 같은 이름을 결합해 유지한다. 위험한 hop-by-hop·proxy header와 줄바꿈이
포함된 값은 거부한다.

## 모델 목록

### `POST /admin/ai-config/models`

```json
{
  "provider": "openai_compatible",
  "baseUrl": "https://ai.example.com/v1",
  "apiKey": "",
  "customHeaders": [
    { "name": "X-Organization", "value": "", "configured": true }
  ]
}
```

입력한 새 비밀값과 DB에 저장된 기존 비밀값을 메모리에서 합쳐 모델을 조회하며 이 요청
자체는 설정을 저장하지 않는다. Gemini는 `generateContent`를 지원하는 모델만 반환하고,
OpenAI-compatible은 `/models`의 ID를 반환한다. 성공 응답은 다음 형태다.

```json
{
  "models": [
    { "id": "gemini-3.6-flash", "label": "Gemini 3.6 Flash" }
  ]
}
```

## 연결 시험

### `POST /admin/ai-config/test`

저장된 공급자·모델·비밀값으로 짧은 실제 생성 요청을 보낸다. 성공하면
`{ "ok": true }`를 반환한다. 모델 폐기·인증·할당량 오류 등 공급자 실패는 502
`ai_provider_error`이며, 이 관리자 전용 응답에는 진단 가능한 공급자 메시지가 포함된다.

## AI 활용 기준

### `GET /admin/term-quality`

현재 최소 글자 수와 프로필별 충족 현황을 반환한다.

### `POST /admin/term-quality`

`definitionMinChars`, `bodyMinChars`를 받아 저장하지 않고 변경 영향을 미리 계산한다.
두 값은 0~10,000 범위의 정수다.

### `PATCH /admin/term-quality`

같은 입력을 워크스페이스 설정에 저장한다. 실제 필수 항목은 용어의 `qualityProfile`과
결합해 계산한다.

## 자동 검토 제안

### `GET /contributions/review-queue`

로그인 세션 또는 `read` API Key로 AI 검토 큐의 전체·처리 중·대기·완료·실패 건수와
최근 용어 목록을 조회한다.

### `POST /contributions/review-queue`

정리 대기 용어의 현재 리비전을 수동 검토 큐에 넣는다. 자동 검토 설정이 꺼져 있어도
AI 연결이 활성화되어 있으면 사용할 수 있다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "revision": 1
}
```

접수되면 202를 반환한다. AI 연결이 꺼져 있으면 503, 정리 대상이 아니거나 리비전이
바뀌었으면 409를 반환한다.

### `GET /contributions/suggestions`

`termId`와 `revision` query를 받아 현재 리비전의 준비된 검토를 반환한다. 아직 생성되지
않았다면 백그라운드 생성을 예약하고 202를 반환한다.

### `PATCH /contributions/suggestions`

AI 관계 제안을 승인하거나 거절한다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "revision": 1,
  "suggestionId": "agent-...-relation-...-used_in",
  "decision": "approved"
}
```

승인된 관계만 RAG의 관계 확장에 사용된다. 제안이 이미 처리됐거나 출발·대상 용어의
리비전이 달라졌으면 409를 반환한다.

### `DELETE /contributions/suggestions`

관계가 아닌 자동 수정 제안 하나를 거절한다. 요청 본문은 `termId`, `revision`,
`suggestionId`를 사용한다.

## 용어집 챗봇

### `POST /chat`

```json
{
  "question": "IT와 SW는 무엇을 뜻해?",
  "history": [
    { "role": "user", "content": "앞에서 말한 용어를 비교해 줘" },
    { "role": "assistant", "content": "..." }
  ],
  "teachingDraft": null
}
```

- `question`: 1~20,000자. 여러 줄 용어집 붙여넣기를 포함한다
- `history`: 최근 8개까지, 역할은 `user` 또는 `assistant`
- `teachingDraft`: 직전 응답의 `teaching.draft`. 새 용어 설명을 이어갈 때 그대로 전송
- 질문과 이력 본문의 합계: 최대 28,000자
- 사용자·API Key별 제한: 분당 20회

성공 응답에는 `answer`와 근거가 된 `sources`가 들어간다. 매칭 용어가 없으면
`teaching: { draft, ready }`로 대화 중인 단일 용어 초안을 반환한다. TSV/CSV, Markdown
표, 목록처럼 여러 줄 용어집을 붙여넣으면 `teachingBatch: { drafts }`에 최대 25개를
반환한다. 이 응답만으로 DB가 변경되지는 않는다.

웹 화면의 확인 버튼은 각 draft를 기존 `POST /terms`에 다음 정책으로 전달한다.

- `status=draft`, `qualityProfile=auto`
- 도메인·업무 분류는 빈 배열로 시작
- 대표 표기 중복 검사를 포함한 기존 생성 규약 적용
- 일괄 붙여넣기는 성공·실패 항목을 나누어 표시

| HTTP | code | 의미 |
|---|---|---|
| 400 | `validation_failed` | 질문 또는 이력 형식·길이 오류 |
| 401 | `unauthorized` | 로그인이나 유효한 API Key가 없음 |
| 429 | `rate_limited` | 분당 요청 제한 초과 |
| 502 | `ai_provider_error` | 모델·인증·할당량·공급자 연결 문제 |
| 503 | `ai_not_enabled` | 관리자가 챗봇을 활성화하지 않음 |

전체 기계 판독 스키마는 `GET /api/v1/openapi`에서 확인할 수 있다.
