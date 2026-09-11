# 의미 관계 API

`GET /api/v1/relations`는 `termId`, `status` (`proposed`, `approved`, `rejected`),
`type` (`related_to`, `is_a`, `part_of`, `used_in`, `prerequisite_of`, `replaces`),
`page` (1부터 시작)를 지원한다. 페이지당 20개이며 `{ items, total, page }`를 반환한다.
각 항목에는 양쪽 용어의 최신 정의·리비전, `stale`, 불투명 동시성 토큰 `version`,
마지막 검토·수정자 정보가 포함된다. 읽기는 로그인 세션 또는 `read` API 키가 필요하다.

`GET /api/v1/relations/terms?q=검색어`는 관계 편집용 용어 후보 최대 20개와 총계를 반환한다.
선택한 후보의 `id`, `revision`을 등록에 사용한다.

`POST /api/v1/relations`는 로그인한 사용자가 관계를 **제안**한다.

```json
{
  "sourceTermId": "출발 용어 UUID",
  "targetTermId": "도착 용어 UUID",
  "relationType": "part_of",
  "evidenceMd": "A는 B의 구성 요소이다. 설계 문서 3절 참조.",
  "sourceRevision": 1,
  "targetRevision": 2
}
```

생성은 `201 { "id": "관계 UUID" }`이며 `proposed`로 저장된다. 근거는 1~4000자이며
자기 자신과의 연결은 허용하지 않는다. 같은 출발·도착·종류의 관계가 있으면 409다.

`PATCH /api/v1/relations/{id}` 역시 로그인 사용자 전용이다. 읽기 응답의 `version`을
전달하며 성공 시 `200 { "id": "관계 UUID" }`를 반환한다.

- 승인: `{ "action": "approved", "version": "조회한 토큰" }`
- 거절·승인 철회: `{ "action": "rejected", "version": "조회한 토큰" }`
- 수정: `action: "edit"`, `version`, `relationType`, `evidenceMd`, `sourceRevision`, `targetRevision`

수정은 출발·도착 용어를 유지하며 최신 용어 정의에 맞춰 종류·근거를 바꾼 뒤 검토 대기로
되돌린다. 방향을 잘못 입력한 관계는 거절하고 올바른 방향으로 새로 제안한다.

현재 리비전과 다른 제안의 승인은 409 `revision_conflict`다. 관리 목록을 새로고침하고
최신 정의를 확인해 수정 후 다시 승인한다. 다른 사람이 관계 자체를 변경한 경우에는
409 `operation_conflict`다. API 키의 쓰기는 403이며, 오류는 공통 `{ error: ... }` 형식이다.

전체 요청·응답 스키마는 `GET /api/v1/openapi`에 포함된다.
