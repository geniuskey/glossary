# 정리 루틴

"용어집 정리해줘", "빈 정의 채워줘"처럼 대상이 특정되지 않은 요청에 쓴다. 각 루틴은 **조회 → 근거 확인 → 변경안 → 저장 → 재조회** 순서를 지키고, 한 번에 처리한 건수와 남은 건수를 보고한다. 경로는 `$GLOSSARY_URL/api/v1` 기준이다.

`/contributions/*` 아래의 AI 제안 POST 엔드포인트는 서버에 연결된 AI 모델을 쓴다. `ai_not_enabled`가 오면 서버 AI 없이 직접 근거를 읽고 변경안을 만든다. 서버가 만든 제안도 근거가 확인될 때만 반영한다.

## 1. 빈 한줄 정의 채우기

1. `GET /contributions/term-definitions` — 본문(`bodyMd`)은 있는데 정의가 빈 용어. 항목마다 `id`, `revision`이 있고 최대 100건이다.
2. 용어 본문을 읽고 본문에 근거한 정의를 쓴다. 서버 AI를 쓰려면 `POST /contributions/term-definitions` `{"termId":"..."}`. 422 `insufficient_body`는 본문 근거가 부족하다는 뜻이므로 정의를 지어내지 말고 보고 목록에 남긴다.
3. 반영: `PATCH /contributions/term-definitions` `{"termId":"...","definitionMd":"...","expectedRevision":N}`. 409면 다시 읽는다.

## 2. 중복 개념 정리

1. `GET /contributions/duplicates?status=pending` — 후보 쌍(`left`, `right`, `signals`, 양쪽 `revision`). 페이지당 30건.
2. 두 용어의 상세·표기·도메인을 비교한다. 서버 AI 판정이 필요하면 `POST /contributions/duplicates` `{"termId":"...","candidateId":"..."}`로 `verdict`(same/different/uncertain)를 받는다.
3. 다른 개념이면 결정만 기록한다:
   `PATCH /contributions/duplicates` `{"action":"decide","leftId":"...","rightId":"...","leftRevision":N,"rightRevision":M,"decision":"different","reason":"도메인이 다름"}`.
   판단이 어려우면 `"decision":"uncertain"`.
4. 같은 개념이면 **병합은 사용자 확인 후에만** 한다. 원본이 보관되어 되돌리기 어렵다.
   `PATCH /contributions/duplicates` `{"sourceId":"...","targetId":"...","sourceRevision":N,"targetRevision":M}` — `source`가 `target`에 흡수된다.

동음이의어(도메인이 다른 같은 표기)는 중복이 아니다. `different`로 기록한다.

## 3. 미분류 용어 분류

1. 관리된 key 목록: `GET /admin/domains`, `GET /admin/categories`(read scope). 여기에 없는 값을 만들지 않는다.
2. 대상 찾기: `GET /terms/catalog`에서 `domain` 또는 `category`가 빈 항목을 고른다.
3. 서버 AI 추천이 필요하면 `POST /contributions/classifications` `{"termId":"...","kind":"domain","expectedRevision":N}`. `suggestion: null`은 근거 부족이다.
4. 반영: `PATCH /terms/{idOrSlug}` `{"domain":["..."],"expectedRevision":N}`. 배열 필드는 교체되므로 기존 값을 포함한다. 여러 건이면 `POST /terms/batch` dry-run부터.

## 4. 문서에서 미등록 용어 찾기

1. 문서 검증(`validate` scope): `POST /validate` `{"content":"...","format":"markdown","options":{"collectCandidates":true}}`. 여러 문서는 `POST /validate/batch`. `findings`에는 금지·비권장 표기 사용도 함께 나온다.
2. 누적된 후보: `GET /candidates?status=open`.
3. 조직 용어가 맞으면 등록: `POST /candidates/{id}/promote` — 본문은 `POST /terms`와 같은 입력이다. 먼저 `GET /terms?q=`로 기존 표기를 확인하고, 기존 용어의 별칭이면 promote 대신 그 용어의 `surfaces`에 추가한 뒤 후보를 무시 처리한다.
4. 일반 단어나 오탐이면: `POST /candidates/{id}/dismiss` `{"note":"일반 명사"}`.

## 5. 회의록·원문에서 지식 추리기

1. 관련 기존 자료: `POST /rag/meetings/search`, `POST /rag/wiki/search`, `GET /terms?q=`.
2. 원문에서 **확정된** 정의·결정만 고른다. 제안·미결 논의는 보고에 "확인 필요"로 남긴다.
3. 새 개념은 용어로, 여러 용어가 얽힌 절차·결정 배경은 위키 초안으로 만든다. 원문 자체를 서버에 보관하는 것(`POST /meetings`)은 사용자가 요청했을 때만 한다.

## 보고 형식

- 처리함: 루틴별 건수와 대표 링크(`/g/{slug}`, `/w/{slug}`)
- 보류함: 근거 부족, 충돌, 세션 권한이 필요한 항목과 이유
- 사람의 결정이 필요함: 병합, 공개, 관계 승인 후보
