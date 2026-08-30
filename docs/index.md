---
layout: home

hero:
  name: Grossary
  text: 조직 특화형 용어집 관리 플랫폼
  tagline: 한국어와 영어로 쓰이는 팀의 용어를 단일 사전으로 모으고, 도구가 API 한 번으로 문서를 검증할 수 있게 만든다.
  actions:
    - theme: brand
      text: 시작하기
      link: /guide/getting-started
    - theme: alt
      text: API 레퍼런스
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/geniuskey/grossary

features:
  - title: 단일 사전 + 동음이의어
    details: 제품별 네임스페이스로 나누지 않는다. 하나의 사전에 모으고 domain 태그로 동음이의어를 구분하며, 등록 시점에 정규화 키 충돌을 경고한다.
  - title: 개념과 표기의 분리
    details: Term(개념)과 TermSurface(표기)를 나눈다. "Auto Exposure", "AE", "오토익스포저"가 모두 같은 개념을 가리키고, 세 가지 검증이 같은 테이블 조회로 풀린다.
  - title: 기계 판독 가능
    details: OpenAPI 3.1 스펙을 GET /api/v1/openapi로 서빙한다. AI-Lint 같은 도구가 POST /terms/lookup 한 번으로 문서에 쓰인 표기 전체를 확인한다.
  - title: 온프레미스
    details: 사내망 Docker Compose 배포. 첨부 이미지까지 Postgres에 들어 있어 pg_dump 결과 파일 하나가 전체 백업이다.
---
