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

## AI 실행 모니터링

### `GET /admin/ai-observability`

관리자 세션만 사용할 수 있다. `hours` 쿼리(1~720, 기본 24)로 기간을 정하면 LLM·Embedding·
Reranker 실행의 호출 수, 성공·실패·실행 중 건수, 평균·P95 지연, 토큰 합계, 작업·공급자·모델별
집계와 최근 실패를 반환한다. RAG 색인과 AI 작업의 현재 상태 및 AI/RAG 연결 준비 상태도
함께 반환한다.

운영 메타데이터에는 trace ID·시도 횟수·HTTP 상태·안전한 오류 분류만 포함되며 프롬프트,
답변 원문, API Key, custom header 값은 저장하지 않는다. 오래된 `running` 실행은 집계 시
프로세스 중단으로 판단해 실패 처리한다.

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

## 콘텐츠 완성도

### `GET /admin/term-quality`

현재 최소 글자 수와 플랫폼이 자동 판정한 기준별 충족 현황을 반환한다.

### `POST /admin/term-quality`

`definitionMinChars`, `bodyMinChars`를 받아 저장하지 않고 변경 영향을 미리 계산한다.
두 값은 0~10,000 범위의 정수다.

### `PATCH /admin/term-quality`

같은 입력을 워크스페이스 설정에 저장한다. 기존 연동과 고급 운영 도구의 호환을 위해
유지하는 API이며, 용어별 `qualityProfile` 값과 관계없이 표기·상태·내용으로 기준을
자동 판정한다.

## 자동 검토 제안

### `GET /contributions/review-queue`

로그인 세션 또는 `read` API Key로 AI 작업의 전체·검토 필요·처리 중·대기·실패 건수와
필터링된 용어 목록을 조회한다. `status=all|attention|active|ready|failed`(`attention`은
검토 필요 또는 실패)와 `page`로
목록 범위를 조정할 수 있다.

### `POST /contributions/review-queue`

정리 대기 용어의 현재 리비전을 수동 검토 큐에 넣는다. 자동 검토 설정이 꺼져 있어도
AI 연결이 활성화되어 있으면 사용할 수 있다. 로그인 세션 또는 `write` API Key가 필요하다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "revision": 1
}
```

여러 용어는 `items` 배열로 한 번에 최대 60건까지 요청할 수 있다. 같은 `termId`가
반복되면 마지막 항목 하나만 처리한다.

오래된 `processing` 작업을 되돌리고 대기 작업을 다시 시작하려면 다음 요청을 사용한다.

```json
{ "action": "resume" }
```

```json
{
  "items": [
    { "termId": "00000000-0000-4000-8000-000000000001", "revision": 1 },
    { "termId": "00000000-0000-4000-8000-000000000002", "revision": 3 }
  ]
}
```

단일 요청과 일괄 요청 모두 접수되면 202를 반환한다. 일괄 요청의 응답은 다음과 같으며,
`skipped`에는 이미 처리 중이거나 정리 대상이 아니거나 리비전이 맞지 않는 항목이 포함된다.

```json
{
  "state": "queued",
  "requested": 2,
  "queued": 1,
  "skipped": 1
}
```

AI 연결이 꺼져 있으면 503, 단일 요청의 용어를 찾지 못하면 404, 요청할 수 있는 항목이
하나도 없으면 409를 반환한다. 각 항목의 리비전은 요청 시점의 현재 리비전이어야 한다.

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

## 한줄 정의 제안

### `GET /contributions/term-definitions`

본문이 있고 한줄 정의가 비어 있는 용어를 오래된 수정 시각 순으로 조회한다. 로그인 세션
또는 `read` API Key가 필요하며, 응답은 `{ items, total }`이다. 웹 화면은 이 결과를
**한줄 정의 정리** 표로 표시한다. 각 항목에는 현재 `revision`, 본문과 같은 리비전에
저장된 `suggestion`이 포함된다.

### `POST /contributions/term-definitions`

용어의 이름·풀네임·본문을 근거로 한줄 정의를 생성한다. 결과는 같은 리비전에 캐시되어
다시 열어도 재사용된다. 로그인 세션 또는 `write` API Key가 필요하며, 이미 저장된 제안을
무시하고 다시 만들려면 `force: true`를 보낸다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "force": false
}
```

성공 응답은 `{ "suggestion": "..." }`다. 본문만으로 정의할 수 없거나 용어가 바뀌면
409/422를 반환하며, AI 공급자 오류는 502다.

### `PATCH /contributions/term-definitions`

한줄 정의 제안 한 건을 승인해 용어에 저장한다. 웹 화면의 **승인** 버튼이 사용하는
엔드포인트다. 로그인 세션 또는 `write` API Key가 필요하며, 줄바꿈 없는 1~1,000자
문자열과 승인 전에 읽은 `expectedRevision`이 필요하다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "definitionMd": "자주 사용하는 데이터를 임시로 저장해 요청을 빠르게 처리하는 방법.",
  "expectedRevision": 1
}
```

리비전이 바뀌었으면 409를 반환한다. 성공 시 용어의 새 리비전이 만들어지며, 승인된
정의는 이후 일반 용어 검색·챗봇·RAG 색인 대상이 된다.

## 분류 추천

### `POST /contributions/classifications`

비어 있는 도메인 또는 업무 분류를 현재 용어의 이름·정의·본문과 용어집 근거를 바탕으로
추천한다. 요청에는 `termId`, `kind`(`domain` 또는 `category`), `expectedRevision`이
필요하다. 응답의 `suggestion.values`는 분류 체계에 실제로 등록된 값만 포함하며,
`reason`은 추천 근거다. 같은 용어·분류·리비전에 대해 이미 생성한 추천은 DB에 저장되어
다시 화면을 열어도 재사용된다. 충분한 근거가 없다는 결과도 저장해 불필요한 재요청을
막는다. 승인 저장이나 용어의 다른 수정으로 리비전이 바뀌면 캐시는 삭제된다. `force: true`
를 사용하면 승인 전 캐시를 무시하고 다시 생성한다. 최종 저장은 자동으로 하지 않으며,
화면에서 사람이 확인한 뒤 기존 용어 수정 API로 승인·저장한다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001",
  "kind": "domain",
  "expectedRevision": 1,
  "force": false
}
```

## 중복 후보 검토

### `GET /contributions/duplicates`

중복 표기 또는 숫자 접미사 URL로 발견한 **후보 쌍**을 페이지당 30건 조회한다. 로그인 세션
또는 `read` API Key가 필요하며, `page` query로 페이지를 바꾼다. `status`는 `pending`(기본),
`uncertain`, `different`, `all` 중 하나이며 응답에는 상태별 `counts`가 포함된다. 각 쌍은
`left`, `right`, 발견 근거 `signals`, 저장된 `decision`과 양쪽 현재 `revision`을 가진다.

### `POST /contributions/duplicates`

기존 용어의 `termId`를 AI로 검토한다. `candidateId`를 함께 보내면 특정 후보 쌍만 비교한다.
가져오기 화면에서는 기존처럼 `source`와 최대 30개의 `candidates`를 보낼 수 있다. 로그인
세션 또는 `write` API Key가 필요하다. 응답의 후보마다 `verdict`가
`same`, `different`, `uncertain` 중 하나로 들어가며, AI의 판단 근거는 `reason`에 들어간다.

```json
{
  "termId": "00000000-0000-4000-8000-000000000001"
}
```

응답은 `{ source, revision, candidates }`이며 후보의 리비전도 포함한다. 대상 용어가 바뀌거나
AI 검토를 완료하지 못하면 409를 반환한다.

### `PATCH /contributions/duplicates`

검토한 두 용어를 병합하거나 후보 쌍의 분리·보류 결정을 저장한다. 병합에서는 `targetId`가
대표 용어가 되고, 양쪽 표기·분류·본문은 보존된다. 두 리비전을 함께 보내야 하며, 로그인
세션 또는 `write` API Key가 필요하다.

분리·보류 결정은 다음 형식이다.

```json
{
  "action": "decide",
  "leftId": "00000000-0000-4000-8000-000000000001",
  "rightId": "00000000-0000-4000-8000-000000000002",
  "leftRevision": 2,
  "rightRevision": 4,
  "decision": "different",
  "reason": "정의와 도메인이 달라 별개 개념"
}
```

병합 요청은 다음 형식이다.

```json
{
  "sourceId": "00000000-0000-4000-8000-000000000001",
  "targetId": "00000000-0000-4000-8000-000000000002",
  "sourceRevision": 2,
  "targetRevision": 4
}
```

성공하면 대표 용어의 `slug`를 반환한다. 어느 한쪽이 먼저 수정·병합되었거나 표기 충돌이
있으면 409를 반환한다.

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
- `domain`: 검색할 도메인 label. 생략하거나 `null`이면 전체 도메인. 카탈로그에 없는 값은 400
- 질문과 이력 본문의 합계: 최대 28,000자
- 사용자·API Key별 제한: 분당 20회

성공 응답에는 `answer`와 모델에 전달한 `sources`가 들어간다. 명시적으로 등록을 요청하면
`teaching: { draft, ready }`로 단일 용어 초안을 반환한다. 여러 줄 용어집 등록 요청은
`teachingBatch: { drafts }`에 최대 25개를 반환한다. 검색 실패만으로 등록을 시작하지 않는다.
기존 용어 수정 요청에는 `edit` 제안이 포함된다. 로그인 사용자는 `sessionId`로 대화를
이어가며 응답의 `messages`가 서버에 저장된 전체 대화다. 이 단계에서 용어 자체는 변경되지 않는다.

근거 답변에는 `grounded`가 포함된다.

- `claims`: `{ text, evidenceIds }` 목록. 각 주장에 연결한 근거 ID
- `evidence`: 실제 인용한 `{ id, termId, slug, title, revision, updatedAt, field, excerpt, start? }` 목록
- `uncertainties`: 부족하거나 추가 확인이 필요한 내용
- `searchedQueries`: 실제 사용한 검색어, 최대 2개
- `domain`: 해당 응답의 검색 범위 또는 `null`

`field`는 `metadata`, `definition`, `body`, `relationship`이다. 관계 근거에는 대상 용어의
`relatedTerm: { termId, slug, title, revision }`도 포함된다. `start`는 원문 문자열의 UTF-16
오프셋이다. `answer`는 인용 번호를 포함한 텍스트이며 번호는 `grounded.evidence` 순서와 대응한다.
`sources`는 근거 답변에서 실제 인용한 용어만 포함하고 리비전·수정 시점을 함께 반환한다.
인용 ID 검사는 문장의 사실성이나 근거의 논리적 타당성 검증을 의미하지 않는다.

RAG 설정에서 **챗봇의 하이브리드 검색 보조**를 켜면 이 답변 생성 전에 Embedding 검색을
시도하고 표기·키워드 검색과 결합한다. 벡터 검색이 실패하면 챗봇은 기존 검색 결과로
계속 답하며, 자세한 벡터 결과 자체가 필요하면 [RAG 검색 API](/api/rag)의 `POST /rag/search`
를 사용한다.

`GET /chat`은 도메인 선택용 `domains` 목록을 함께 반환한다. 메시지의 `searchDomain`과
`grounded`를 저장하므로 재조회해도 당시 범위와 구절이 유지된다.

웹 화면의 확인 버튼은 각 draft를 기존 `POST /terms`에 다음 정책으로 전달한다.

- `qualityProfile=auto`; 정리 상태는 현재 작성 기준에 따라 자동 계산
- 사용자 제공 도메인·업무 분류·추가 표기를 보존하며 기존 카탈로그와 표기 검증 적용
- 대표 표기 중복 검사를 포함한 기존 생성 규약 적용
- 일괄 붙여넣기는 성공·실패 항목을 나누어 표시

### `POST /chat/actions`

로그인 사용자가 자신의 대화에 저장된 수정안을 적용하거나 취소한다. API Key로는
호출할 수 없다. 요청에는 변경 내용을 넣지 않고 서버가 발급한 식별자만 보낸다.

```json
{
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "actionId": "00000000-0000-4000-8000-000000000002",
  "action": "apply"
}
```

`action`은 `apply` 또는 `cancel`이다. 응답의 `edit.status`는 `applied` 또는 `cancelled`이며
적용 성공 시 `edit.appliedRevision`에 리비전 번호가 들어간다. 이미 종료된 작업은 기존
결과를 반환한다. 용어가 변경되어 기준 리비전이 다르면 409 `revision_conflict`를 반환한다.
용어 변경·리비전·완료 기록은 함께 커밋되며, 일부 저장에 실패하면 함께 롤백된다.

`PATCH /chat`으로는 서버가 작성한 `edit` 제안·실행 상태나 `grounded` 답변·구절·출처를 변경할 수 없다.

용어집을 Embedding API와 pgvector로 검색하는 별도 API는 [RAG 검색 API](/api/rag)에서 설명한다.

### `POST /chat` 오류 응답

| HTTP | code | 의미 |
|---|---|---|
| 400 | `validation_failed` | 질문 또는 이력 형식·길이 오류 |
| 401 | `unauthorized` | 로그인이나 유효한 API Key가 없음 |
| 429 | `rate_limited` | 분당 요청 제한 초과 |
| 502 | `ai_provider_error` | 모델·인증·할당량·공급자 연결 문제 |
| 503 | `ai_not_enabled` | 관리자가 챗봇을 활성화하지 않음 |

전체 기계 판독 스키마는 `GET /api/v1/openapi`에서 확인할 수 있다.
