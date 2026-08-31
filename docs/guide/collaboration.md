# 담당자·카테고리·관계도

## 용어별 담당자

새 용어와 편집 화면에서 현재 사용자 한 명을 담당자로 지정할 수 있다. 담당자는 승인 권한을
독점하는 사람이 아니라, 해당 용어를 읽을 수 있는 수준까지 정리할 책임자다. 다른 편집자도
계속 내용을 보탤 수 있으며, 담당자가 탈퇴하면 값은 자동으로 미지정 상태가 된다.

`함께 정리` 화면에서는 내 담당 용어가 먼저 나오고, 각 카드와 상세 화면에서 담당자를 확인한다.

SSO 사용자는 로그인할 때 IdP가 확인해 준 group/조직이 이름 뒤에 표시된다. 여러
그룹이 전달되면 모두 표시하며, 로컬 계정이나 그룹 claim이 없는 계정은 이메일을 표시한다.
예를 들어 `Platform 조직` claim이 확인된 사용자는 담당자 선택과 목록에서
`김민지 · Platform 조직`으로 표시된다.

## 도메인과 카테고리

- **도메인**: 용어가 쓰이는 넓은 제품·업무 영역이며 여러 개를 지정할 수 있다.
- **카테고리**: 도메인 안의 한 단계 좁은 분류이며 하나만 지정한다.

시트에서는 둘을 각각 열과 필터로 사용한다. 엑셀 임포트도 `카테고리`, `category`, `분류`
헤더를 인식한다.

## 관계도

`/graph`는 별도의 관계를 추측해 저장하지 않는다. 실제로 관리하는 도메인과 카테고리를 허브로,
용어를 노드로 그려 같은 맥락의 용어를 탐색한다. 도메인·카테고리 필터로 큰 그래프를 좁힐 수 있다.

## Confluence 임베드

`시트` 상단의 **공유하기**를 누르면 현재 검색·필터·정렬을 유지한 읽기 전용 표를
만들 수 있다. `표시할 열`에서 필요한 열만 체크하고, 촘촘한 행·상세 링크·바깥 테두리
여부를 고른다. 같은 설정으로 다음 두 결과를 각각 복사할 수 있다.

- **공유 URL**: 새 탭에서 열거나 Confluence URL 매크로에 붙인다.
- **iframe 코드**: HTML/iframe 삽입을 지원하는 매크로에 붙인다.

열 정의는 `columns` 쿼리에 표준 열 키의 쉼표 목록으로 들어간다. 주소를 직접 만들 수도
있지만, 알 수 없는 열 키는 무시되고 유효한 열이 하나도 없으면 기본 열 구성을 사용한다.

```text
https://glossary.example.com/embed?domain=ISP&category=노출%20제어&sort=nameEn&dir=asc&columns=nameEn,nameKo,domain,definitionMd&compact=1&links=1&border=1
```

```html
<iframe src="https://glossary.example.com/embed?..." title="Grossary 용어 시트" width="100%" height="560" loading="lazy" style="border:1px solid #e7e3dc;border-radius:8px"></iframe>
```

운영 환경에는 iframe을 허용할 Confluence origin을 설정한다.

```dotenv
GROSSARY_EMBED_ANCESTORS=https://confluence.example.com
```

여러 출처는 쉼표로 구분한다. 값이 비어 있으면 동일 출처 외에는 프레임 삽입이 차단된다.
공유 표는 최대 200개의 공개 상태 용어만 보여 주며 초안은 노출하지 않는다. 임베드 화면도
Grossary 로그인을 요구한다. 브라우저의 서드파티 쿠키 제한을 피하려면
Grossary와 Confluence를 같은 사이트 범위의 서브도메인으로 운영하는 편이 안전하다.
