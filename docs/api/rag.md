# RAG 검색 API

용어집의 대표 표기·풀네임·추가 표기·도메인·업무 분류·주제·상태·정의·본문을 청크로
나누어 `pgvector`에 저장하고, 질문을 같은 Embedding 공간으로 바꾸어 검색한다. 경로는
모두 `/api/v1` 기준이다.

RAG 설정과 색인 대기열은 DB에 저장된다. 용어를 등록·수정하거나 분류 체계를 바꾸면 해당
최신 내용이 대기열에 들어가며, 응답 뒤 백그라운드에서 색인한다. 기존 용어·저장된 회의록·공개
위키는 관리자 화면의 **전체 재색인**으로 다시 넣을 수 있다. `chatEnabled`를 켜면 용어
챗봇도 이 색인을 표기·키워드 검색과 함께 사용하는 하이브리드 검색 경로를 선택적으로
호출한다. 회의록과 위키는 용어와 별도 vector 인덱스를 사용한다. 보관된 회의록과 공개되지 않은 위키는
검색에서 제외된다. 위키는 용어에 연결된 업무 원칙·프로세스·플레이북을 저장하는 지식
문서이며, 초안은 검토 전까지 AI의 공식 근거가 되지 않는다.

## 관리자 설정

### `GET /admin/rag-config`

관리자 세션만 사용할 수 있다. Embedding/Reranker 공급자, Base URL, 모델, 청크 설정과
색인 통계를 반환한다. API Key와 custom header 값은 반환하지 않고 `hasApiKey`와 header
이름·`configured`만 반환한다.

### `PATCH /admin/rag-config`

```json
{
  "enabled": true,
  "chatEnabled": false,
  "embeddingProvider": "openai_compatible",
  "embeddingBaseUrl": "https://api.openai.com/v1",
  "embeddingModel": "text-embedding-3-small",
  "embeddingApiKey": "...",
  "embeddingCustomHeaders": [],
  "rerankerEnabled": true,
  "rerankerProvider": "cohere_compatible",
  "rerankerBaseUrl": "https://api.cohere.com/v2",
  "rerankerModel": "rerank-v3.5",
  "rerankerApiKey": "...",
  "rerankerCustomHeaders": [],
  "chunkSize": 1600,
  "chunkOverlap": 240,
  "topK": 8
}
```

`chatEnabled`는 챗봇의 하이브리드 검색 보조 여부다. 기본값은 `false`이며, 켜면 챗봇
질문이 Embedding 공급자에 전송될 수 있다. 벡터 공급자가 일시적으로 실패하거나 해당
리비전이 아직 색인되지 않았을 때 챗봇은 기존 표기·키워드 검색으로 폴백한다. 직접 벡터
결과가 필요한 호출자는 아래의 `POST /rag/search`를 사용한다.

`embeddingProvider`는 `openai_compatible` 또는 `gemini`이고, `rerankerProvider`는
`cohere_compatible` 또는 `openai_compatible`이다. Embedding 출력과 DB 벡터 차원은 **1536으로 고정**한다. OpenAI
호환 서버에는 `/embeddings` 요청의 `dimensions: 1536`을, Gemini에는
`batchEmbedContents` 요청의 `outputDimensionality: 1536`을 보낸다.

Base URL은 공급자에 따라 마지막 경로를 자동으로 붙인다.

- OpenAI-compatible Embedding: `{baseUrl}/embeddings`
- Gemini Embedding: `{baseUrl}/models/{model}:batchEmbedContents`
- Cohere/OpenAI-compatible Reranker: `{baseUrl}/rerank`

API Key는 OpenAI/Cohere 호환 서버에는 `Authorization: Bearer`로, Gemini에는
`x-goog-api-key`로 보낸다. custom header는 공급자별 추가 인증·테넌트 헤더에 사용하며
최대 20개, 줄바꿈 없는 값만 허용한다. 저장된 비밀값은 `GLOSSARY_ENCRYPTION_KEY`로
AES-256-GCM 암호화한다.

API Key 또는 header를 생략하거나 빈 값으로 보내면 저장된 값을 유지하고, `null`이면 API
Key를 삭제한다. GET 응답에서 받은 header 이름에 빈 값을 넣어 보내도 기존 값이 유지된다.
header 행을 제거하면 해당 header가 삭제된다.

### `POST /admin/rag-config/models`

OpenAI-compatible 공급자의 `/v1/models`를 조회해 RAG 용도에 맞는 모델만 반환한다. `baseUrl`에
`https://company.example/v1`을 넣으면 해당 주소의 `/v1/models`를 호출한다. `endpoint`가
`embedding`이면 모델 ID에 `embed`, `reranker`이면 `reranker`가 포함된 모델만 선택지로
반환한다. 응답은 `{ "models": [{ "id": "company-embed-large", "label": "company-embed-large" }] }`
형식이며 설정을 저장하지 않는다. Embedding·Reranker를 같은 서버에서 서빙하면 두 요청에
같은 Base URL을 사용하면 된다.

`chunkSize`는 400~8000자, `chunkOverlap`은 0 이상이고 청크 크기보다 작아야 하며,
`topK`는 1~50이다. Embedding 모델이나 Base URL, 청크 설정을 저장하면 모든 현재 용어를
재색인 대기열에 넣는다.

### `POST /admin/rag-config/test`

저장된 설정으로 짧은 Embedding 요청을 보내고, Reranker가 켜져 있으면 Reranker 요청도
보낸다. 성공 응답은 `{ "ok": true, "embedding": true, "reranker": true }`이고 공급자
연결·인증·모델·할당량 문제는 502 `rag_provider_error`다.

### `POST /admin/rag-config/reindex`

현재 용어·활성 회의록·공개 위키 전체를 최신 리비전 기준으로 대기열에 넣고 202를 반환한다.

```json
{ "ok": true, "queued": 137, "queuedMeetings": 24, "queuedWikiPages": 18 }
```

색인 통계의 `queued`, `processing`, `ready`, `failed`로 진행 상태를 확인한다. 공급자
오류가 난 항목은 `failed`와 안전하게 잘린 오류 메시지로 남고, 연결을 고친 뒤 전체 재색인을
다시 실행할 수 있다.

## 벡터 검색

### `POST /rag/search`

로그인 세션 또는 `read` scope API Key가 필요하다.

```bash
curl -s \
  -H "Authorization: Bearer glk_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -d '{"query":"해외 정산 예외 처리 방법", "topK":5, "domain":"Finance", "rerank":true}' \
  http://localhost:3000/api/v1/rag/search
```

요청 필드는 다음과 같다.

| 필드 | 필수 | 설명 |
|---|---:|---|
| `query` | 예 | 1~20,000자의 검색 질문 |
| `topK` | 아니오 | 결과 수 1~50. 생략하면 관리자 설정 사용 |
| `domain` | 아니오 | 특정 도메인만 검색. `null` 또는 생략하면 전체 |
| `rerank` | 아니오 | Reranker 사용 여부. 생략하면 관리자 설정 사용 |

응답의 `items`는 청크 단위 결과다. 같은 용어의 정의·본문이 여러 청크로 반환될 수 있다.
`revision`은 색인한 용어 리비전이며, 검색 대상은 병합되지 않은 용어의 현재 리비전만이다.
`score`는 cosine 거리를 1에 가까울수록 유사하게 변환한 값이고, Reranker를 사용한 항목은
`rerankScore`도 가진다.

```json
{
  "query": "해외 정산 예외 처리 방법",
  "total": 1,
  "reranked": true,
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "termId": "00000000-0000-4000-8000-000000000002",
      "slug": "settlement-exception",
      "title": "정산 예외",
      "nameEn": "Settlement Exception",
      "nameKo": "정산 예외",
      "domain": ["Finance"],
      "categories": ["process"],
      "topic": "정산",
      "status": "active",
      "revision": 3,
      "sourceField": "body",
      "content": "용어 정산 예외의 본문:\n…",
      "metadata": { "termId": "…", "revision": 3, "sourceField": "body" },
      "score": 0.87,
      "rerankScore": 0.94,
      "updatedAt": "2026-09-16T00:00:00.000Z"
    }
  ]
}
```

## 오류

| HTTP | code | 의미 |
|---:|---|---|
| 400 | `validation_failed` | 검색어·필터 형식이 잘못됨 |
| 401 | `unauthorized` | 세션 또는 유효한 API Key가 없음 |
| 502 | `rag_provider_error` | Embedding/Reranker 서버 연결·인증·응답 문제 |
| 503 | `rag_not_ready` | RAG가 꺼져 있거나 저장된 비밀값을 읽을 수 없음 |

RAG 검색 API는 용어집과 저장된 회의록 내용을 외부 Embedding/Reranker 공급자에 전송할 수
있다. 사내 정책에 맞는 공급자나 사내 OpenAI-compatible 서버를 선택하고, 운영 환경에서는
반드시 TLS URL과 고정된 `GLOSSARY_ENCRYPTION_KEY`를 사용한다.

## 회의록 지식

### `POST /meetings`

로그인 세션 또는 `write` scope API Key로 회의록을 명시적으로 저장한다. `content`는 최대
200,000자이며, `title`, `meetingDate`, `source`, `team`, `domain` 메타데이터를 함께 저장할
수 있다. 저장 직후에는 원문만 확정되고 Embedding 색인은 durable queue에서 비동기로 진행된다.

```json
{
  "title": "2026 Q3 상품 회의",
  "meetingDate": "2026-09-18T02:00:00.000Z",
  "source": "Notion",
  "team": "상품팀",
  "domain": ["Product"],
  "content": "결정: ...\n액션 아이템: ..."
}
```

`GET /meetings`는 활성 회의록 메타데이터를 조회하며 `status=archived`로 보관 목록도 볼 수
있다. `GET /meetings/{id}`는 원문을 반환하고, `PATCH /meetings/{id}`는 메타데이터·원문을
새 revision으로 저장하거나 `status: "archived"`로 보관한다. 삭제 대신 보관을 사용해 당시
의사결정의 감사 근거를 남긴다.

### `POST /rag/meetings/search`

로그인 세션 또는 `read` scope API Key가 필요하다. 현재 활성 회의록 revision의 청크를
검색하며 `domain`, `team`, `from`, `to`, `topK`, `rerank` 필터를 지원한다.

```json
{
  "query": "지난 분기에 합의한 출시 기준과 담당자는 무엇인가?",
  "topK": 5,
  "domain": "Product",
  "from": "2026-07-01T00:00:00.000Z",
  "to": "2026-09-30T23:59:59.999Z"
}
```

검색 결과에는 회의록 ID·제목·회의일·revision·원문 청크의 `startOffset`/`endOffset`가
포함된다. 챗봇은 이 결과를 용어집 근거와 구분해 인용하고, 회의록이 당시 논의의 기록일
뿐 현재 정책의 자동 승인은 아니라는 점을 답변 지침에 포함한다.

## 위키 지식

### `GET /wiki`

로그인 세션 또는 `read` scope API Key로 위키 목록을 조회한다. `q`, `status`, `domain`,
`termId`, `page`, `pageSize` 필터를 지원한다. 기본 목록에서는 archived 문서를 제외한다.

### `POST /wiki`

로그인 세션 또는 `write` scope API Key로 업무 지식 문서를 저장한다. `title`과 `content`가
필수이며, `summary`, `domain`, `termSlugs`, `status`를 선택할 수 있다. `termSlugs`의 첫
번째 용어는 대표 용어가 된다. slug를 생략하면 제목에서 만들고, 용어 slug와 겹치지 않도록
자동으로 검사한다.

```json
{
  "title": "출시 기준 플레이북",
  "summary": "베타 출시 전 확인할 기준과 담당 흐름",
  "domain": ["상품"],
  "termSlugs": ["release-gate", "beta"],
  "status": "draft",
  "content": "## 체크리스트\n\n출시 기준을 확인한다."
}
```

### `GET/PATCH /wiki/{slug}`

문서 원문을 조회하거나 수정한다. 수정 때마다 revision과 감사용 snapshot이 남고, published
문서는 최신 revision으로 RAG 색인이 예약된다. 초안 또는 archived로 바꾸면 기존 위키 청크가
검색에서 제거된다.

### `POST /rag/wiki/search` — 위키 벡터 검색

로그인 세션 또는 `read` scope API Key가 필요하다. `POST /rag/search`와 같은 `query`, `topK`,
`domain`, `rerank` 필드를 사용하지만 published 위키 문서만 검색한다. 결과에는 `wikiPageId`,
`slug`, `revision`, `startOffset`, `endOffset`, `score`가 포함된다. 챗봇 근거에서는 위키
출처를 `W`로 표시해 용어집 `G`, 회의록 `M`과 구분한다.
