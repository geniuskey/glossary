# 용어 API

`{idOrSlug}`는 UUID와 slug 둘 다 받는다. UUID 형식이 아니면 slug로 조회한다.

## 목록 조회

```http
GET /api/v1/terms?q=exposure&type=concept&domain=ISP&category=design&topic=노출%20제어&status=active&page=1&pageSize=20
```

| 파라미터 | 기본값 | 설명 |
|---|---|---|
| `q` | — | 검색어. **Term이 아니라 Surface를 향한다** |
| `type` | — | `concept` \| `proper_name` \| `identifier` \| `unit` |
| `domain` | — | 도메인 태그 하나 |
| `category` | — | 관리자가 구성한 업무 분류의 안정적인 key 하나 |
| `topic` | — | 자유 입력 세부 주제 하나 |
| `status` | — | `active` \| `deprecated` \| `forbidden` |
| `page` | 1 | |
| `pageSize` | 20 | 1~100으로 클램프된다 |

```json
{ "items": [ /* TermSummary[] */ ], "total": 137, "page": 1, "pageSize": 20 }
```

`TermSummary`는 `id`, `slug`, `termType`, `nameEn`, `nameKo`, `domain`, `category`, `categoryLabel`, `topic`,
`ownerId`, `ownerName`, `status`다.

`category`는 URL·API용 key이고 `categoryLabel`은 현재 표시 이름이다. 관리자가 표시 이름을
바꿔도 key와 기존 링크는 유지된다.

::: tip 검색이 Surface를 향하는 이유
"오토익스포저"나 `auto-exposure`로 검색해도 AE 개념 페이지에 도착해야 한다.
사람들은 표준 표기를 **모르기 때문에** 용어집을 찾는다. 표준 표기로만 검색되면 도구가
무용지물이다. `pg_trgm` 유사도로 오타도 흡수한다.
:::

### 잘못된 파라미터의 처리

- `?type=foo`처럼 **알 수 없는 enum 값** → 400 `validation_failed`.
  `details`에 `field`와 `allowed`가 실린다.
- `?type=`처럼 **빈 값** → "지정 안 함"으로 조용히 무시한다. `<select>`를 아무것도
  고르지 않고 제출한 폼이 이런 쿼리스트링을 만든다.
- `?page=abc`, `?page=1e999` → 400 `validation_failed`. 재시도해도 성공하지 않는
  입력이므로 500이 아니다.

같은 규칙이 **화면**(`/sheet`)에는 적용되지 않는다. 화면은 알 수 없는 값을 조용히
무시하고 기본값을 쓴다 — 사람이 주소창을 손으로 고치다 낸 오타 하나로 에러 페이지를
띄우면 안 되기 때문이다.

## 등록

```http
POST /api/v1/terms
Content-Type: application/json

{
  "termType": "concept",
  "nameEn": "AE",
  "nameKo": "자동노출",
  "fullNameEn": "Auto Exposure",
  "domain": ["ISP"],
  "category": "design",
  "topic": "노출 제어",
  "ownerId": "11111111-1111-1111-1111-111111111111",
  "status": "active",
  "definitionMd": "장면 밝기에 따라 노출을 자동으로 맞추는 기능.",
  "surfaces": [
    { "text": "AE", "lang": "en", "kind": "abbreviation" },
    { "text": "오토익스포저", "lang": "ko", "kind": "alias" },
    { "text": "auto exposure control", "lang": "en", "kind": "discouraged" }
  ]
}
```

`nameEn` 또는 `nameKo` 중 **최소 하나**는 있어야 한다.

### 표기는 자동으로 파생된다

`surfaces`에 직접 넣지 않아도 표준 이름에서 표기가 만들어진다.

| 필드 | 파생되는 kind |
|---|---|
| `nameEn` | 기본은 `canonical`. 같은 표기를 `abbreviation`으로 명시하면 약어 속성을 우선 보존 |
| `nameKo` | `canonical` |
| `fullNameEn`, `fullNameKo` | `full_name` |

`caseSensitive`를 주지 않으면 `^[A-Z0-9]{2,6}$`에 맞는 짧은 전대문자 표기만 true가
된다. `AE`는 대소문자를 구분하고 `Auto Exposure`는 구분하지 않는다.

정규화 키와 kind가 같으면 먼저 온 쪽이 남는다. 파생 표기가 명시 표기보다 앞이다.
약어는 Type이 아니므로 `surfaces`에 `kind: "abbreviation"`으로 명시한다. 대표 영문명과
약어 텍스트가 같으면 두 표기를 중복 생성하지 않고 약어 표기 하나로 저장한다.

### 201, 409가 아니다

```json
{
  "term": { "id": "…", "slug": "ae", "updatedAt": "2026-08-28T01:02:03.000Z", "…": "…" },
  "surfaces": [ { "id": "…", "text": "AE", "lang": "en", "kind": "abbreviation", "caseSensitive": true } ],
  "warnings": [ { "surfaceText": "AE", "conflictingSlug": "ae-audio-engine" } ]
}
```

정규화 키가 기존 용어와 충돌해도 **409를 던지지 않는다.** 동음이의어를 허용하기로 한
설계이므로 저장은 그대로 진행하고 `warnings`로만 알린다. 등록을 막으면 안 되지만
"이미 이런 용어가 있다"는 반드시 보여줘야 한다.

`warnings`는 표기 텍스트와 충돌 대상 slug만 담는다. 화면이 "표기 → 기존 용어로 이동"
링크를 그리는 데 그 둘이면 충분하다.

### 400이 나는 경우

- `nameEn`/`nameKo`가 둘 다 없다.
- 표기가 trim 후에도 기호뿐이라(`"---"`) 정규화하면 빈 문자열이 된다.
  `.trim().min(1)`으로는 잡히지 않는다 — 정규화의 구분자 집합이 JS `trim()`보다 넓다.
- 같은 정규화 키에 **서로 모순되는 kind**가 붙어 있다.
  승인군(`canonical`/`abbreviation`/`full_name`/`alias`)과
  비승인군(`discouraged`/`forbidden`)이 같은 키에 함께 올 수 없고,
  `discouraged`와 `forbidden`이 동시에 붙을 수도 없다.

## 상세

```http
GET /api/v1/terms/ae
```

```json
{
  "term": {
    "id": "…", "slug": "ae", "termType": "concept",
    "nameEn": "AE", "nameKo": "자동노출",
    "fullNameEn": "Auto Exposure", "fullNameKo": null,
    "domain": ["ISP"], "status": "active",
    "definitionMd": "…", "bodyMd": null,
    "updatedAt": "2026-08-28T01:02:03.000Z",
    "surfaces": [ /* SurfaceRow[] */ ],
    "homonyms": [ /* TermSummary[] — 같은 표기의 다른 용어 */ ]
  }
}
```

`updatedAt`은 항상 ISO 문자열이다. `homonyms`가 비어 있지 않으면 화면이 상단에
"같은 표기의 다른 용어" 목록을 띄운다.

없으면 404 `term_not_found`.

## 수정

```http
PATCH /api/v1/terms/ae
Content-Type: application/json

{ "status": "deprecated", "definitionMd": "…", "expectedRevision": 6, "message": "정의 보강" }
```

부분 갱신이라 표준 표기 필수 조건이 걸리지 않는다. 응답 형태는 [등록](#등록)과 같다
(`{ term, surfaces, warnings }`).

`surfaces`를 아예 보내지 않으면 기존 명시 표기를 유지한다. 보내면 그 배열이 명시 표기
전체를 대체한다.

### URL 주소 변경

편집 화면의 URL 변경 버튼은 slug만 별도로 PATCH하고, 성공하면 새 편집 주소로 이동한다.

```http
PATCH /api/v1/terms/ae
Content-Type: application/json

{ "slug": "auto exposure", "expectedRevision": 6 }
```

서버는 입력을 `auto-exposure`처럼 소문자·하이픈 형식으로 정리한다. 이미 사용 중인
주소면 저장하지 않고 409 `slug_conflict`를 반환한다. 예약 주소와 UUID 형식은 400으로
거부한다.

### 낙관적 잠금

편집 화면은 자기가 읽은 리비전 번호를 들고 있다가 저장 시점에 `expectedRevision`으로
되돌려 보낸다. 그 사이 남이 고쳤으면 서버가 덮어쓰지 않고 409로 거절한다.

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "다른 사람이 먼저 수정했습니다.",
    "details": { "currentRevision": 8 }
  }
}
```

클라이언트는 `details.currentRevision`으로 상대 변경을 다시 읽어 diff를 보여준 뒤
병합을 유도한다. 비관적 잠금은 "잠가놓고 퇴근한 사람" 문제를 만들어 쓰지 않는다.

`expectedRevision`을 생략하면 잠금 검사를 건너뛴다 — 도구가 무조건 덮어써야 하는
경우를 위한 것이므로 사람이 쓰는 편집 경로에서는 항상 실어 보낸다.

## 삭제

```http
DELETE /api/v1/terms/ae
```

`admin` 역할이 필요하다. API 키에는 역할 개념이 없으므로 **키로는 호출할 수 없다**
(403 `forbidden`). 성공하면 204다. 표기와 리비전은 `ON DELETE CASCADE`로 함께 사라진다.

## 수정 이력

```http
GET /api/v1/terms/ae/revisions
```

최신순으로 돌려준다.

```json
{
  "revisions": [
    {
      "id": "…", "revisionNumber": 8, "message": "정의 보강",
      "authorId": "…", "authorKeyId": null, "authorName": "홍길동",
      "createdAt": "2026-08-28T01:02:03.000Z"
    }
  ]
}
```

`authorId`와 `authorKeyId`는 서로 배타적이다 — 세션 요청은 앞쪽, API 키 요청은 뒤쪽에
찍힌다. `authorName`은 조인해서 실어주므로 화면이 id를 다시 풀 필요가 없다. 사용자가
삭제됐으면 `authorId`는 남아도 `authorName`이 null일 수 있다.

## 되돌리기

```http
POST /api/v1/terms/ae/revisions/6/revert
Content-Type: application/json

{ "expectedRevision": 8 }
```

리비전 6의 스냅샷을 지금 상태에 덮어쓴다. 응답 형태는 [수정](#수정)과 같다
(`{ term, surfaces, warnings }`).

**되돌려도 이력은 지워지지 않는다.** 리비전 6~8이 사라지는 게 아니라, 6의 내용을 담은
새 리비전 9가 쌓이고 메시지는 `#6으로 되돌림`으로 남는다. 되돌리기를 되돌리는 것도
그냥 또 한 번의 되돌리기다. 승인 워크플로우가 없는 개방 편집에서 안전판은 라벨이 아니라
이 이력이므로, 이력을 깎는 방식은 쓰지 않는다.

- 로그인한 사용자면 누구나 호출할 수 있다(`write` scope API 키도 가능). 삭제와 달리
  `admin`을 요구하지 않는다 — 되돌리기는 파괴적이지 않기 때문이다.
- `expectedRevision`은 [수정](#낙관적-잠금)과 같은 낙관적 잠금이다. 이력 화면을 열어 둔
  사이 남이 먼저 고쳤으면 409 `revision_conflict`. 화면의 되돌리기 버튼은 항상 실어
  보낸다 — 되돌리기가 남의 편집을 조용히 지우는 도구가 되면 안 된다.
- 본문은 없어도 된다. 그러면 잠금 검사 없이 되돌린다.
- 대상 리비전 이후에 추가된 표기는 사라지고, 그때 있던 표기가 복원된다. 그 리비전에
  정의가 없었다면 정의도 비워진다.
- 없는 리비전 번호는 404 `not_found`, 없는 용어는 404 `term_not_found`다.

::: tip 왜 GET이 아닌가
되돌리기는 쓰기다. 링크(`GET`)로 만들면 "이 링크 눌러봐" 한 줄로 남의 용어를 되돌릴 수
있게 되어, `SameSite=Lax` 쿠키뿐인 이 사이트의 CSRF 방어가 그대로 뚫린다.
:::

## 배치 조회 lookup

AI-Lint 통합 지점이다. 실제 호출 패턴이 "이 목록이 다 등록돼 있나?"라서 배치를 기본으로 둔다.

```http
POST /api/v1/terms/lookup
Content-Type: application/json

{ "texts": ["AE", "이미지센서", "AutoExposure", "Foobar"] }
```

`texts`는 1~500개다. 빈 문자열과 공백뿐인 문자열은 400이다.

```json
{
  "results": [
    {
      "text": "AE",
      "found": true,
      "matchKind": "abbreviation",
      "terms": [
        { "id": "t_ae", "slug": "ae", "termType": "concept",
          "nameEn": "AE", "nameKo": "자동노출", "domain": ["ISP"], "status": "active" }
      ],
      "similar": []
    },
    {
      "text": "Foobar",
      "found": false,
      "matchKind": null,
      "terms": [],
      "similar": [{ "slug": "foobar-mode", "score": 0.72 }]
    }
  ]
}
```

동작상 알아둘 것.

- **`text`는 요청 원문 그대로 되돌아온다.** `"  ZDK  "`를 보내면 `"  ZDK  "`가 온다.
  정규화는 내부에서만 일어난다.
- `results`는 요청한 `texts`와 **같은 길이, 같은 순서**다. 중복 표기를 보내도 그대로
  각각 응답한다(내부 조회는 한 번만 한다).
- `matchKind`는 매칭된 표기가 여럿일 때 우선순위로 하나를 고른 것이다.
  `forbidden > discouraged > canonical > abbreviation > full_name > alias`.
  행 순서가 아니라 코드에 명시 고정된 표다 — 같은 표기가 alias이자 forbidden으로
  등록돼 있을 때 alias가 먼저 나오면 린터가 금지 표기를 놓친다.
- `similar`는 **못 찾았을 때만** 채워진다. `pg_trgm` 유사도 상위 3개이고, 같은 용어가
  여러 표기로 걸려도 slug 기준으로 이미 중복 제거되어 있다. 정렬은 점수 내림차순,
  동점이면 slug 오름차순으로 완전히 고정된다.
- 정규화하면 빈 문자열이 되는 입력(`"---"` 같은 것)은 매칭도 유사도 조회도 대상이
  되지 않는다.

상태를 바꾸지 않는 읽기 동작인데 POST인 이유는, 문서 전체를 훑는 배치 요청이라 본문이
GET 쿼리스트링에 담기지 않기 때문이다. "상태를 바꾸는 GET을 만들지 않는다"는 불변식과는
무관하다.

## 자동완성 suggest

홈 검색창이 한 글자마다 부르는 자리다. 응답을 작게 유지한다 — 정의문·도메인·리비전은
싣지 않는다.

```http
GET /api/v1/terms/suggest?q=sy
```

`q`는 필수다. 없거나 공백뿐이면 400 `validation_failed`(`details.field`가 `"q"`).

```json
{
  "items": [
    { "id": "t_soc", "slug": "system-on-chip",
      "nameEn": "System on Chip", "nameKo": "시스템 온 칩", "status": "active",
      "matchedText": "SoC", "matchedKind": "abbreviation", "exact": false, "prefix": true }
  ]
}
```

동작상 알아둘 것.

- 후보는 최대 8개다. 개수를 조절하는 파라미터는 없다 — 더 넓게 보려는 요청은
  [`GET /terms`](#목록-조회)가 받는다.
- **`prefix`가 자동완성과 오타 교정을 가른다.** 입력이 그 표기의 앞부분이면 `true`,
  `pg_trgm` 유사도로만 걸렸으면 `false`다. 화면은 이 값으로 목록을 두 묶음으로 나눈다
  (섞어서 보여주면 사용자가 자기 오타를 끝까지 모른다).
- 앞부분 판정은 정규화 키(`norm_loose`) 기준이다. `"sysonchip"`으로 `"System on Chip"`이
  걸릴 수 있으므로, 눈에 보이는 문자열이 입력으로 시작한다는 보장은 없다.
- 한 용어에 걸린 표기가 여럿이어도 후보는 **용어당 하나**다. 정렬은
  정확 매치 → 앞부분 매치 → 유사도 → 짧은 표기 순.
- 정규화하면 빈 문자열이 되는 입력은 빈 `items`를 돌려준다.
