# 엑셀 임포트

기존 엑셀 용어집을 옮기는 경로다. **dry-run이 기본**이고 실제 반영은 명시해야 한다.

```http
POST /api/v1/import
Content-Type: multipart/form-data
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | ✔ | xlsx 파일. 10MB까지 |
| `dryRun` | | 보내지 않으면 **dry-run**이다. 실제 반영은 `"false"`를 명시해야 한다 |
| `force` | | 충돌·중복으로 걸린 행 중 그래도 등록할 행 번호를 쉼표로 나열 |

행은 한 번에 **최대 5000개**다(파싱 성공 행 + 행 단위 오류 행). 넘으면 400
`validation_failed`이고 `details`에 `maxRows`와 `actual`이 실린다.

::: warning dryRun의 기본값이 dry-run인 이유
`dryRun` 필드를 잘못 보내거나 빠뜨렸을 때 수백 행이 실수로 들어가는 쪽보다,
아무 일도 일어나지 않는 쪽이 안전하다. `dryRun !== "false"`가 곧 dry-run이다.
:::

## 인식하는 헤더

첫 행이 헤더다. 기존 엑셀이 어떤 헤더를 쓰는지 미리 알 수 없어 매핑이 관대하다.
비교 전에 소문자로 바꾸고 공백을 `_`로 치환하므로 `Name EN`과 `name_en`은 같은 열이다.

| 필드 | 인식하는 헤더 |
|---|---|
| `nameEn` | `name_en`, `english`, `영문`, `영문명` |
| `nameKo` | `name_ko`, `korean`, `한글`, `한글명` |
| `fullNameEn` | `full_name_en`, `영문 풀네임`, `풀네임`, `전체명` |
| `fullNameKo` | `full_name_ko`, `한글 풀네임` |
| `termType` | `term_type`, `종류`, `유형` |
| `domain` | `domain`, `도메인` |
| `category` | `category`, `카테고리`, `업무 분류` |
| `topic` | `topic`, `주제`, `세부 주제` |
| `status` | `status`, `상태` |
| `definitionMd` | `definition`, `정의`, `설명` |
| `aliases` | `aliases`, `별칭`, `약칭` |
| `abbreviations` | `abbreviations`, `약어` |

`domain`, `aliases`, `abbreviations`는 쉼표로 나눈다. `termType`은 `concept`,
`proper_name`, `identifier`, `unit` 중 하나다. `category`에는 관리자 화면에 등록된 업무
분류 key를 쓴다(가져오기 화면에 현재 허용 목록이 표시된다). 약어는 Type이 아니라
`abbreviations` 열에 적는다.

못 알아본 헤더는 **조용히 사라지지 않고** 응답의 `ignoredHeaders`에 원문 그대로
실려 온다. 관대한 매핑 때문에 한 컬럼이 통째로 무시된 것을 모르고 넘어가면 안 된다.

## dry-run

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" \
  -F "file=@glossary.xlsx" \
  http://localhost:3000/api/v1/import
```

```json
{
  "dryRun": true,
  "report": {
    "total": 312,
    "ready": 297,
    "conflicts": [
      { "rowNumber": 41, "name": "AE", "conflictingSlugs": ["ae-audio-engine"] }
    ],
    "duplicatesInFile": [
      { "key": "autoexposure", "rowNumbers": [12, 205] }
    ],
    "errors": [
      { "rowNumber": 88, "message": "영문명과 한글명이 모두 비어 있습니다." }
    ],
    "fileErrors": [],
    "ignoredHeaders": ["담당자", "비고"]
  }
}
```

용어를 정확히 읽는 법.

- **`total`** = 파싱된 행 + 행 단위 오류 행. 파일 단위 실패는 여기 안 들어간다.
- **`ready`** = "파싱된 행 수"가 아니라 **"충돌도 파일 내 중복도 없어서 그대로 반영
  가능한 행 수"**다. 화면의 "N개 실제로 등록하기" 버튼 문구가 이 값을 그대로 쓴다.
- **`conflicts`** = 기존 DB의 용어와 정규화 키가 겹치는 행. 한 행이 기존 용어 여러
  개와 겹쳐도 **행 하나당 항목 하나**다. 그래서 `conflicts.length`가 곧 충돌 행 수다.
- **`duplicatesInFile`** = 파일 안에서 같은 정규화 키가 여러 행에 나온 경우.
- **`errors`** = 행 단위 실패. `rowNumber`는 워크시트의 실제 행 번호(1-base)다.
- **`fileErrors`** = "시트를 찾을 수 없습니다", "인식 가능한 헤더가 없습니다"처럼
  아직 행이라는 개념이 성립하지 않는 파일 단위 실패. `total`에서 빠져 있다.

## 반영

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" \
  -F "file=@glossary.xlsx" -F "dryRun=false" -F "force=41,205" \
  http://localhost:3000/api/v1/import
```

```json
{
  "dryRun": false,
  "created": 299,
  "skipped": [
    { "rowNumber": 12, "reason": "duplicate_in_file" },
    { "rowNumber": 77, "reason": "conflict" }
  ],
  "parseErrors": [],
  "fileErrors": [],
  "ignoredHeaders": []
}
```

`skipped[].reason`은 `conflict` 또는 `duplicate_in_file`이다.

::: tip 반영은 dry-run 결과를 믿지 않는다
반영 요청은 클라이언트가 넘긴 판정을 신뢰하지 않고 **매번 스스로 같은 판정을 다시
계산한다.** dry-run을 아예 건너뛰고 바로 반영을 호출해도, 두 요청 사이에 DB 상태가
바뀌어도 안전하다. `force`에 명시적으로 담긴 행만 예외로 그대로 등록한다 —
동음이의어는 합법이므로 강제 경로는 남겨두되 기본값은 항상 "건너뛴다"다.
:::

`force` 값이 이상하면(정수가 아니거나 0 이하) 조용히 무시한다. 잘못 파싱된 행 번호가
강제 등록 대상에 끼어드는 쪽보다 안전하다.

## 크기 제한

10MB 상한은 두 겹으로 검사한다.

1. `Content-Length` 헤더를 **본문을 읽기 전에** 확인한다. `formData()`는 호출하는
   순간 본문 전체를 메모리에 올리므로 그 뒤에 검사하면 이미 늦다. xlsx는 압축률이
   높아 20만 행이 10MB 안에 들어간다.
2. 파싱 후 `file.size`를 다시 확인한다. 헤더가 없거나 클라이언트가 거짓 값을 보낸
   경우의 두 번째 방어선이다.

둘 다 413 `payload_too_large`다. 표준 Fetch API에 스트리밍 멀티파트 파서가 없어
완전한 조기 차단은 이 플랫폼의 구조적 한계다.

## 화면에서 하기

`/import`가 같은 흐름을 감싼다. 파일 업로드 → dry-run 리포트 확인 → 충돌 행 중
"그래도 등록"할 것을 고르고 → 반영.

같은 화면이 위 표와 같은 내용을 설명으로 싣고, `/import/template`에서 채워 넣을
샘플 xlsx를 내려받게 한다. 열 정의는 `src/lib/import/format.ts` 하나에서 나오므로
파서·샘플 파일·화면 설명이 따로 놀 수 없다.
