# 제품 화면 둘러보기

Glossary v0.3.0의 주요 흐름을 실제 브라우저 화면으로 살펴봅니다. 아래 이미지는 로컬
시드 데이터가 있는 데스크톱 화면에서 캡처했으며, 화면에 보이는 용어 수와 예시 데이터는
설치 환경에 따라 달라집니다.

## 빠른 검색과 용어 관리

홈에서는 약어·별칭·금지 표기를 한 번에 검색하고, 등록된 용어 수와 정리 대기 작업으로
바로 이동할 수 있습니다. 자세한 사용법은 [제품 도움말](/help)을 참고하세요.

<figure>
  <img src="/screenshots/home-search.webp" alt="Glossary 홈의 용어 검색 화면" loading="lazy" />
  <figcaption>홈 — 용어 검색과 지금 필요한 작업으로 바로 이동</figcaption>
</figure>

시트는 용어를 표 형태로 훑고, 상태·도메인·업무 분류를 확인하며, 열 설정과 페이지 크기를
조정하는 작업 공간입니다. 엑셀에서 복사한 표를 붙여 넣거나 내보낼 수도 있습니다.

<figure>
  <img src="/screenshots/term-sheet.webp" alt="Glossary 시트의 용어 표 화면" loading="lazy" />
  <figcaption>시트 — 상태, 도메인, 분류와 정의를 한 화면에서 확인</figcaption>
</figure>

용어 편집 화면에서는 대표 표기와 확장 표기, 한줄 정의, 분류와 관계를 한 개념 아래에서
관리하고 변경 이력을 남깁니다.

<figure>
  <img src="/screenshots/term-edit.webp" alt="Runbook 용어 편집 화면" loading="lazy" />
  <figcaption>용어 편집 — 표기와 정의를 보완하고 변경사항을 저장</figcaption>
</figure>

## 협업과 문서 품질

[함께 정리](/guide/contribute) 화면은 정리 대기 용어를 필요한 정보별로 모아 보여줍니다.
여러 항목을 선택해 AI 검토를 요청하거나, 정의·도메인·업무 분류를 이어서 보완할 수 있습니다.

<figure>
  <img src="/screenshots/contribute-queue.webp" alt="함께 정리의 정리 대기 큐 화면" loading="lazy" />
  <figcaption>함께 정리 — 부족한 정보를 찾아 보완하는 작업 큐</figcaption>
</figure>

[문서 점검](/api/validation)과 `/check` 화면은 문서에서 비표준 표기·금칙어·미등록 후보를
찾습니다. 후보는 용어로 등록하거나 무시해 다음 점검의 검토 목록을 정리할 수 있습니다.

<figure>
  <img src="/screenshots/document-check.webp" alt="문서 점검 화면의 문서 입력 영역" loading="lazy" />
  <figcaption>문서 점검 — 붙여 넣은 문서를 현재 용어집 기준으로 검사</figcaption>
</figure>

새 용어 화면은 대표 영문·국문 표기와 한줄 정의를 먼저 입력하고, 필요한 확장 표기를
추가하는 흐름입니다. 저장 후에는 시트와 검색에서 같은 개념으로 관리됩니다.

<figure>
  <img src="/screenshots/new-term.webp" alt="새 용어 등록 화면" loading="lazy" />
  <figcaption>새 용어 — 기본 정보와 한줄 정의부터 시작</figcaption>
</figure>

## AI와 맥락 탐색

[용어 챗봇](/guide/ai)은 용어집 근거를 바탕으로 질문하고, 대화 중 새 용어 등록·정의 수정·
표기 추가 제안을 검토하는 화면입니다. AI 연결은 관리자 패널에서 선택적으로 설정합니다.

<figure>
  <img src="/screenshots/chatbot.webp" alt="용어 챗봇의 대화 시작 화면" loading="lazy" />
  <figcaption>용어 챗봇 — 도메인 범위를 정하고 용어집에 질문</figcaption>
</figure>

관계도는 용어 사이의 분류·의미 관계를 시각적으로 탐색하는 화면입니다. 필터와 확대·축소로
관심 있는 맥락을 좁혀 볼 수 있습니다.

<figure>
  <img src="/screenshots/relation-graph.webp" alt="용어 관계도 그래프 화면" loading="lazy" />
  <figcaption>관계도 — 용어 사이의 맥락과 연결을 시각적으로 탐색</figcaption>
</figure>

화면별 API와 자동화 연동은 [API 개요](/api/)와 [문서 검증 API](/api/validation)에서
확인할 수 있습니다.
