# 문서 검증

문서 검증 API는 활성 상태이며 병합되지 않은 용어의 표기를 문서 본문에서 찾는다.
API 키에는 `validate` scope가 필요하다. 웹 세션으로도 호출할 수 있다.

## 사전 스냅샷 {#lexicon-snapshot}

### `GET /api/v1/lexicon`

```bash
curl -s \
  -H "Authorization: Bearer glk_<prefix>_<secret>" \
  http://localhost:3000/api/v1/lexicon
```

응답에는 `lexiconVersion`, `entries`, `total`이 들어간다. `ETag`를 저장해 다음 요청에
`If-None-Match`로 보내면 사전이 바뀌지 않은 경우 `304 Not Modified`를 받는다.
초안과 병합된 용어는 문서 검증 사전에서 제외한다.

```json
{
  "lexiconVersion": "sha256:…",
  "entries": [
    {
      "termId": "…",
      "slug": "auto-exposure",
      "text": "AE",
      "kind": "abbreviation",
      "replacement": null
    }
  ],
  "total": 1
}
```

클라이언트가 사전을 내려받아 로컬에서 검사할 때는 `@glossary/engine`의
`compileLexicon`과 `validateDocument`를 사용할 수 있다. 같은 `lexiconVersion`을
검증 결과에 기록하면 CI 결과를 재현할 수 있다.

## 문서 검증 {#validate-document}

### `POST /api/v1/validate`

```json
{
  "content": "AE 대신 자동노출을 사용합니다.",
  "format": "markdown",
  "path": "docs/isp.md",
  "options": {
    "minSeverity": "info",
    "extractUnregistered": true,
    "collectCandidates": true,
    "ignoredCandidates": ["TODO"]
  }
}
```

규칙은 다음과 같다.

| 규칙 | 심각도 | 의미 |
| --- | --- | --- |
| `forbidden` | error | 금지된 표기 |
| `non_standard` | warning | 비권장 표기. 대표 표기를 제안 |
| `ambiguous` | warning | 여러 용어가 같은 표기를 사용 |
| `unregistered` | info | 사전에 없는 약어·제품 코드·영문 후보 |

`format`이 `markdown`이면 fenced code block, inline code, URL, 이미지 경로,
front matter는 검사하지 않는다. `span.start`와 `span.end`는 JavaScript 문자열의
UTF-16 offset이며 `line`, `col`은 1부터 시작한다.

## 일괄 검증 {#validate-batch}

### `POST /api/v1/validate/batch`

`documents`에 최대 100개 문서를 넣는다. 각 문서의 결과는 `path`, `stats`, `findings`를
가지며 사전 버전은 전체 응답의 `lexiconVersion`으로 한 번만 반환된다. 문서 하나는
최대 1,000,000자, 일괄 요청 전체는 최대 10,000,000자다.

단일 검증과 마찬가지로 `options.collectCandidates: true`를 보내면 각 문서의 미등록
후보를 검토 목록에 누적한다. 기본값은 `false`다.

```json
{
  "documents": [
    { "path": "README.md", "content": "…", "format": "markdown" },
    { "path": "notes.txt", "content": "…", "format": "plain" }
  ]
}
```

현재 범위에는 GitHub·VS Code 연동, 자동 수정, 미등록 후보의 자동 등록이 포함되지 않는다.
검증 결과의 미등록 후보는 `collectCandidates: true`일 때 검토 목록에 누적된다. 등록과 무시는
화면(`/check`) 또는 아래 후보 API에서 사람이 처리한다. GitHub·VS Code 연동과 자동 수정은
현재 범위에 포함되지 않는다.

## 후보 처리 {#candidates}

### `GET /api/v1/candidates`

`status=open`이 기본이며 `q`, `page`, `pageSize`로 후보를 좁힐 수 있다. 응답에는 발생 횟수,
샘플 문맥, 마지막 `source`, 사전 버전이 들어간다. `source`는 웹 화면에서는 문서 이름·출처,
CI에서는 저장소 경로처럼 팀이 후보가 발견된 문서를 식별할 수 있는 값이다.

### `POST /api/v1/candidates/{id}/dismiss`

후보를 무시 처리한다. 선택적으로 `{ "note": "일반 명사" }`를 보낼 수 있다. 무시된 후보는
다음 검증에서 다시 열린 후보로 쌓이지 않는다.

### `POST /api/v1/candidates/{id}/promote`

`POST /terms`와 같은 용어 입력을 받아 초안 용어를 만들고 후보를 `promoted`로 바꾼다.
화면에서는 후보 표기를 영문명 또는 국문명으로 미리 채운 뒤 정의를 추가할 수 있다.
