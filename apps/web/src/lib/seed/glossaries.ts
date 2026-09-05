import type { TermTypeLiteral } from "@/lib/terms/enums";

/**
 * 처음 켠 용어집은 빈 표다. 무엇을 어떻게 적어야 하는지 보여 줄 예시가 하나도
 * 없으면 첫 사람이 형식을 전부 발명해야 하고, 그렇게 만들어진 첫 스무 줄이
 * 그대로 그 팀의 관례가 된다 — 그래서 기본 묶음을 손으로 골라 둔다.
 *
 * 여기 있는 항목은 "정답"이 아니라 출발점이다. 팀이 쓰는 말이 다르면 고치거나
 * 지우면 된다. 그래서 seed-terms.ts는 이미 있는 표기와 겹치는 항목을 건너뛴다.
 *
 * @glossary/db도 zod도 import하지 않는다(R114와 같은 이유 — 이 모듈은 스크립트와
 * 테스트 양쪽에서 읽힌다). 값이 스키마를 통과하는지는 tests/seed-glossaries.test.ts가
 * termInputSchema에 실제로 먹여서 확인한다.
 */
export interface SeedTerm {
  nameEn?: string;
  nameKo?: string;
  fullNameEn?: string;
  fullNameKo?: string;
  termType?: TermTypeLiteral;
  /** 대표 영문 표기가 약어일 때 그 표기 kind를 Type과 독립적으로 보존한다. */
  primaryKind?: "abbreviation";
  definitionMd: string;
  /** 같은 개념을 가리키는 다른 표기. 검색으로 찾아지되 표준명은 아니다. */
  aliases?: readonly string[];
}

export interface SeedPack {
  /** 명령행에서 고르는 이름. */
  key: string;
  label: string;
  /** 이 묶음이 무엇을 담는지 한 줄. 명령어가 목록을 찍을 때 같이 나간다. */
  summary: string;
  /** 이 묶음의 모든 용어에 붙는 도메인. 나중에 통째로 골라내거나 지울 수 있다. */
  domain: readonly string[];
  terms: readonly SeedTerm[];
}

const GENERAL: SeedPack = {
  key: "general",
  label: "일반 용어집",
  summary: "회의·문서·일정에서 매일 오가는 업무 공통어",
  domain: ["일반"],
  terms: [
    {
      nameEn: "KPI",
      nameKo: "핵심성과지표",
      fullNameEn: "Key Performance Indicator",
      primaryKind: "abbreviation",
      definitionMd: "목표를 얼마나 달성했는지 숫자 하나로 보기 위해 정해 두는 지표.",
    },
    {
      nameEn: "OKR",
      nameKo: "목표·핵심결과",
      fullNameEn: "Objectives and Key Results",
      primaryKind: "abbreviation",
      definitionMd: "무엇을 이룰지(목표)와 이뤘음을 어떻게 알지(핵심 결과)를 짝지어 세우는 목표 관리 방식.",
    },
    {
      nameEn: "SLA",
      nameKo: "서비스 수준 협약",
      fullNameEn: "Service Level Agreement",
      primaryKind: "abbreviation",
      definitionMd: "제공하는 쪽이 지키기로 약속한 응답 시간·가동률 같은 품질 기준을 문서로 못박은 것.",
    },
    {
      nameEn: "RFP",
      nameKo: "제안요청서",
      fullNameEn: "Request for Proposal",
      primaryKind: "abbreviation",
      definitionMd: "무엇이 필요한지 조건을 적어 공급자에게 제안서를 요청하는 문서.",
    },
    {
      nameEn: "NDA",
      nameKo: "비밀유지계약",
      fullNameEn: "Non-Disclosure Agreement",
      primaryKind: "abbreviation",
      definitionMd: "일을 하며 알게 된 정보를 밖으로 내지 않기로 서로 약속하는 계약.",
    },
    {
      nameEn: "MOU",
      nameKo: "업무협약",
      fullNameEn: "Memorandum of Understanding",
      primaryKind: "abbreviation",
      definitionMd: "함께 하기로 한 뜻을 먼저 적어 두는 합의서. 법적 구속력은 보통 계약보다 약하다.",
    },
    {
      nameEn: "PoC",
      nameKo: "개념검증",
      fullNameEn: "Proof of Concept",
      primaryKind: "abbreviation",
      definitionMd: "본격적으로 만들기 전에 \"이 방식이 되긴 되는가\"만 작게 확인해 보는 단계.",
    },
    {
      nameEn: "ROI",
      nameKo: "투자수익률",
      fullNameEn: "Return on Investment",
      primaryKind: "abbreviation",
      definitionMd: "들인 비용 대비 얼마를 돌려받았는지의 비율.",
    },
    {
      nameEn: "WBS",
      nameKo: "작업분류체계",
      fullNameEn: "Work Breakdown Structure",
      primaryKind: "abbreviation",
      definitionMd: "할 일을 더 못 쪼갤 때까지 나눠 계층으로 늘어놓은 표. 일정과 담당은 여기에 붙인다.",
    },
    {
      nameEn: "TBD",
      nameKo: "미정",
      fullNameEn: "To Be Determined",
      primaryKind: "abbreviation",
      definitionMd: "아직 정하지 않았다는 표시. 문서에 남겨 두면 \"빠뜨린 것\"이 아니라 \"정할 것\"이 된다.",
    },
    {
      nameEn: "Milestone",
      nameKo: "마일스톤",
      definitionMd: "일정을 끊어 보는 기준점. 그 시점에 무엇이 끝나 있어야 하는지로 정의한다.",
    },
    {
      nameEn: "Deliverable",
      nameKo: "산출물",
      definitionMd: "일이 끝났음을 보여 주는, 남에게 넘길 수 있는 결과물.",
    },
    {
      nameEn: "Stakeholder",
      nameKo: "이해관계자",
      definitionMd: "결과에 영향을 받거나 결정에 영향을 주는 사람·조직.",
    },
    {
      nameEn: "Onboarding",
      nameKo: "온보딩",
      definitionMd: "새로 합류한 사람이 혼자 일할 수 있게 되기까지의 안내 과정.",
    },
    {
      nameEn: "Retrospective",
      nameKo: "회고",
      definitionMd: "끝난 일을 두고 무엇이 잘됐고 무엇을 바꿀지 함께 정리하는 자리.",
      aliases: ["레트로"],
    },
    {
      nameEn: "Backlog",
      nameKo: "백로그",
      definitionMd: "아직 하지 않은 일을 우선순위대로 모아 둔 목록.",
    },
    {
      nameEn: "Lead time",
      nameKo: "리드타임",
      definitionMd: "요청이 들어온 시점부터 결과가 나올 때까지 실제로 걸리는 시간.",
    },
    {
      nameEn: "Escalation",
      nameKo: "에스컬레이션",
      definitionMd: "현재 담당 선에서 풀 수 없는 문제를 결정 권한이 있는 위쪽으로 올리는 것.",
    },
    {
      nameEn: "Action item",
      nameKo: "액션 아이템",
      definitionMd: "회의에서 정해진, 담당자와 기한이 붙은 할 일.",
    },
    {
      nameEn: "Agenda",
      nameKo: "안건",
      definitionMd: "그 회의에서 다룰 항목과 순서.",
    },
    {
      nameEn: "Handover",
      nameKo: "인수인계",
      definitionMd: "맡던 일을 다음 사람이 이어받을 수 있도록 맥락과 자료까지 넘기는 것.",
    },
    {
      nameEn: "Blocker",
      nameKo: "블로커",
      definitionMd: "치우기 전에는 일을 더 진행할 수 없게 만드는 장애물.",
    },
    {
      nameEn: "Scope creep",
      nameKo: "범위 확산",
      definitionMd: "합의한 범위가 조금씩 늘어나 일정과 비용이 조용히 불어나는 현상.",
    },
    {
      nameEn: "Due date",
      nameKo: "기한",
      definitionMd: "그때까지는 끝나 있어야 하는 날짜.",
    },
  ],
};

const IT: SeedPack = {
  key: "it",
  label: "IT 용어집",
  summary: "개발·운영에서 쓰는 기본어와 AI 용어",
  domain: ["IT"],
  terms: [
    {
      nameEn: "API",
      nameKo: "응용 프로그램 인터페이스",
      fullNameEn: "Application Programming Interface",
      primaryKind: "abbreviation",
      definitionMd: "프로그램끼리 주고받는 약속된 창구. 안이 어떻게 생겼는지 몰라도 이 창구로만 부르면 된다.",
    },
    {
      nameEn: "REST",
      nameKo: "레스트",
      fullNameEn: "Representational State Transfer",
      primaryKind: "abbreviation",
      definitionMd: "자원을 URL로 가리키고 HTTP 메서드로 다루는 웹 API 설계 방식.",
    },
    {
      nameEn: "SDK",
      nameKo: "소프트웨어 개발 키트",
      fullNameEn: "Software Development Kit",
      primaryKind: "abbreviation",
      definitionMd: "어떤 플랫폼용 프로그램을 만들 때 필요한 라이브러리·도구·예제 묶음.",
    },
    {
      nameEn: "CLI",
      nameKo: "명령줄 인터페이스",
      fullNameEn: "Command Line Interface",
      primaryKind: "abbreviation",
      definitionMd: "화면의 버튼이 아니라 명령어를 쳐서 쓰는 조작 방식.",
    },
    {
      nameEn: "CI",
      nameKo: "지속적 통합",
      fullNameEn: "Continuous Integration",
      primaryKind: "abbreviation",
      definitionMd: "고친 코드를 자주 합치고 그때마다 자동으로 빌드·테스트해서 깨진 곳을 일찍 찾는 방식.",
    },
    {
      nameEn: "CD",
      nameKo: "지속적 배포",
      fullNameEn: "Continuous Delivery",
      primaryKind: "abbreviation",
      definitionMd: "통합을 통과한 코드를 언제든 내보낼 수 있는 상태로 자동화해 두는 것.",
    },
    {
      nameEn: "SSO",
      nameKo: "통합 인증",
      fullNameEn: "Single Sign-On",
      primaryKind: "abbreviation",
      definitionMd: "한 번 로그인하면 연결된 여러 서비스에 다시 로그인하지 않고 들어가는 방식.",
    },
    {
      nameEn: "OAuth",
      nameKo: "오오스",
      definitionMd: "비밀번호를 넘기지 않고 \"이 앱에 내 계정의 이 권한만 준다\"를 표현하는 권한 위임 규약.",
    },
    {
      nameEn: "JWT",
      nameKo: "제이슨 웹 토큰",
      fullNameEn: "JSON Web Token",
      primaryKind: "abbreviation",
      definitionMd: "서명이 붙어 있어 내용이 바뀌지 않았음을 확인할 수 있는, 스스로 정보를 담은 토큰.",
    },
    {
      nameEn: "CDN",
      nameKo: "콘텐츠 전송 네트워크",
      fullNameEn: "Content Delivery Network",
      primaryKind: "abbreviation",
      definitionMd: "같은 파일을 세계 곳곳에 미리 복사해 두고 가장 가까운 곳에서 내려주는 망.",
    },
    {
      nameEn: "DNS",
      nameKo: "도메인 이름 시스템",
      fullNameEn: "Domain Name System",
      primaryKind: "abbreviation",
      definitionMd: "사람이 읽는 주소를 실제 서버의 IP 주소로 바꿔 주는 체계.",
    },
    {
      nameEn: "VPN",
      nameKo: "가상 사설망",
      fullNameEn: "Virtual Private Network",
      primaryKind: "abbreviation",
      definitionMd: "공용 인터넷 위에 암호화된 통로를 만들어 사내망처럼 쓰게 하는 기술.",
    },
    {
      nameEn: "Container",
      nameKo: "컨테이너",
      definitionMd: "프로그램과 그것이 필요로 하는 것들을 한 덩어리로 묶어, 어느 기계에서도 같게 도는 실행 단위.",
    },
    {
      nameEn: "Kubernetes",
      nameKo: "쿠버네티스",
      definitionMd: "여러 대에 흩어진 컨테이너를 대신 배치·감시·재시작해 주는 오케스트레이션 도구.",
      aliases: ["K8s"],
    },
    {
      nameEn: "Microservice",
      nameKo: "마이크로서비스",
      definitionMd: "하나의 큰 프로그램 대신, 따로 배포할 수 있는 작은 서비스 여럿으로 나눠 만드는 구조.",
    },
    {
      nameEn: "Cache",
      nameKo: "캐시",
      definitionMd: "느린 곳에서 가져온 결과를 가까운 곳에 잠시 두고 다시 쓰는 것.",
    },
    {
      nameEn: "Latency",
      nameKo: "지연시간",
      definitionMd: "요청을 보내고 첫 응답이 올 때까지 걸리는 시간.",
    },
    {
      nameEn: "Throughput",
      nameKo: "처리량",
      definitionMd: "단위 시간에 처리해 내는 일의 양. 지연시간이 짧아도 처리량은 낮을 수 있다.",
    },
    {
      nameEn: "Idempotency",
      nameKo: "멱등성",
      definitionMd: "같은 요청을 여러 번 보내도 결과가 한 번 보낸 것과 같은 성질. 재시도를 안전하게 만든다.",
    },
    {
      nameEn: "Race condition",
      nameKo: "경쟁 상태",
      definitionMd: "둘 이상이 같은 것을 동시에 건드릴 때 실행 순서에 따라 결과가 달라지는 결함.",
    },
    {
      nameEn: "Technical debt",
      nameKo: "기술 부채",
      definitionMd: "지금 빨리 가려고 미뤄 둔 정리. 나중에 이자처럼 더 큰 작업으로 돌아온다.",
    },
    {
      nameEn: "Rollback",
      nameKo: "롤백",
      definitionMd: "문제가 생긴 변경을 되돌려 직전의 정상 상태로 돌아가는 것.",
    },
    {
      nameEn: "AI",
      nameKo: "인공지능",
      fullNameEn: "Artificial Intelligence",
      primaryKind: "abbreviation",
      definitionMd: "사람이 하던 인식·판단·생성 같은 일을 기계가 수행하게 하는 기술 전반.",
    },
    {
      nameEn: "ML",
      nameKo: "기계학습",
      fullNameEn: "Machine Learning",
      primaryKind: "abbreviation",
      definitionMd: "규칙을 사람이 적어 넣는 대신 데이터에서 규칙을 찾아내게 하는 방법.",
    },
    {
      nameEn: "Deep learning",
      nameKo: "딥러닝",
      definitionMd: "여러 층으로 쌓은 신경망으로 데이터의 특징까지 스스로 배우게 하는 기계학습 갈래.",
    },
    {
      nameEn: "LLM",
      nameKo: "대규모 언어 모델",
      fullNameEn: "Large Language Model",
      primaryKind: "abbreviation",
      definitionMd: "방대한 글로 학습해 다음에 올 말을 예측하는 방식으로 문장을 이해하고 생성하는 모델.",
    },
    {
      nameEn: "RAG",
      nameKo: "검색 증강 생성",
      fullNameEn: "Retrieval-Augmented Generation",
      primaryKind: "abbreviation",
      definitionMd: "질문에 답하기 전에 관련 문서를 찾아 함께 넣어 줌으로써, 모델이 근거를 두고 답하게 하는 방식.",
    },
    {
      nameEn: "Prompt",
      nameKo: "프롬프트",
      definitionMd: "모델에게 무엇을 어떻게 해 달라고 건네는 입력 글.",
    },
    {
      nameEn: "Token",
      nameKo: "토큰",
      definitionMd: "모델이 글을 다루는 최소 조각. 길이·요금·한계가 모두 이 단위로 센다.",
    },
    {
      nameEn: "Embedding",
      nameKo: "임베딩",
      definitionMd: "글이나 이미지를 의미가 가까울수록 서로 가까운 숫자 벡터로 바꾼 표현.",
    },
    {
      nameEn: "Fine-tuning",
      nameKo: "미세조정",
      definitionMd: "이미 학습된 모델을 우리 데이터로 조금 더 훈련시켜 우리 일에 맞추는 것.",
    },
    {
      nameEn: "Hallucination",
      nameKo: "환각",
      definitionMd: "모델이 사실이 아닌 내용을 사실처럼 그럴듯하게 지어내는 현상.",
    },
    {
      nameEn: "Context window",
      nameKo: "컨텍스트 윈도우",
      definitionMd: "모델이 한 번에 볼 수 있는 입력의 최대 길이. 넘치면 앞부분부터 보이지 않는다.",
    },
    {
      nameEn: "Inference",
      nameKo: "추론",
      definitionMd: "학습을 마친 모델에 입력을 넣어 결과를 얻는 단계. 서비스에서 실제로 도는 부분이다.",
    },
  ],
};

const SEMICONDUCTOR: SeedPack = {
  key: "semiconductor",
  label: "반도체 용어집",
  summary: "웨이퍼 공정부터 패키징·테스트까지의 현장어",
  domain: ["반도체"],
  terms: [
    {
      nameEn: "Wafer",
      nameKo: "웨이퍼",
      definitionMd: "실리콘 잉곳을 얇게 잘라 낸 원판. 이 위에 회로를 만든다.",
    },
    {
      nameEn: "Die",
      nameKo: "다이",
      definitionMd: "웨이퍼에서 잘라 낸 낱개 칩 하나.",
    },
    {
      nameEn: "Yield",
      nameKo: "수율",
      definitionMd: "만든 것 중 쓸 수 있는 것의 비율. 원가를 가장 크게 좌우한다.",
    },
    {
      nameEn: "Photolithography",
      nameKo: "포토리소그래피",
      definitionMd: "빛으로 마스크의 회로 모양을 감광막에 새기는 공정.",
      aliases: ["노광"],
    },
    {
      nameEn: "Etching",
      nameKo: "식각",
      definitionMd: "필요 없는 부분을 화학 반응이나 플라스마로 깎아 내는 공정.",
    },
    {
      nameEn: "Deposition",
      nameKo: "증착",
      definitionMd: "웨이퍼 위에 얇은 막을 입히는 공정.",
    },
    {
      nameEn: "CMP",
      nameKo: "화학적 기계 연마",
      fullNameEn: "Chemical Mechanical Planarization",
      primaryKind: "abbreviation",
      definitionMd: "쌓아 올린 층의 표면을 화학과 연마로 평평하게 만드는 공정.",
    },
    {
      nameEn: "Ion implantation",
      nameKo: "이온 주입",
      definitionMd: "불순물 이온을 가속해 실리콘에 박아 넣어 전기적 성질을 바꾸는 공정.",
    },
    {
      nameEn: "Doping",
      nameKo: "도핑",
      definitionMd: "순수한 반도체에 불순물을 더해 전자나 정공을 늘리는 것.",
    },
    {
      nameEn: "Epitaxy",
      nameKo: "에피택시",
      definitionMd: "아래 결정의 배열을 그대로 이어받게 결정층을 키우는 성장 공정.",
    },
    {
      nameEn: "EUV",
      nameKo: "극자외선",
      fullNameEn: "Extreme Ultraviolet",
      primaryKind: "abbreviation",
      definitionMd: "파장 13.5nm의 빛을 쓰는 노광 방식. 더 미세한 회로를 한 번에 새길 수 있다.",
    },
    {
      nameEn: "Reticle",
      nameKo: "레티클",
      definitionMd: "노광기에 걸어 회로 모양을 웨이퍼에 옮기는 원판.",
      aliases: ["마스크"],
    },
    {
      nameEn: "FEOL",
      nameKo: "전공정",
      fullNameEn: "Front End of Line",
      primaryKind: "abbreviation",
      definitionMd: "웨이퍼 위에 트랜지스터 자체를 만드는 앞단 공정.",
    },
    {
      nameEn: "BEOL",
      nameKo: "후단 배선 공정",
      fullNameEn: "Back End of Line",
      primaryKind: "abbreviation",
      definitionMd: "만들어진 소자들을 금속 배선으로 이어 주는 뒷단 공정.",
    },
    {
      nameEn: "Fab",
      nameKo: "팹",
      definitionMd: "웨이퍼를 실제로 가공하는 반도체 생산 공장.",
    },
    {
      nameEn: "Foundry",
      nameKo: "파운드리",
      definitionMd: "설계는 하지 않고 남의 설계를 받아 생산만 맡는 위탁 생산 사업.",
    },
    {
      nameEn: "Fabless",
      nameKo: "팹리스",
      definitionMd: "공장 없이 설계만 하고 생산은 파운드리에 맡기는 사업 형태.",
    },
    {
      nameEn: "OSAT",
      nameKo: "패키징·테스트 외주",
      fullNameEn: "Outsourced Semiconductor Assembly and Test",
      primaryKind: "abbreviation",
      definitionMd: "칩의 패키징과 최종 테스트를 전문으로 맡아 하는 외주 업체.",
    },
    {
      nameEn: "Packaging",
      nameKo: "패키징",
      definitionMd: "다이를 보호하고 바깥 회로와 이어 주도록 감싸는 공정.",
    },
    {
      nameEn: "Wire bonding",
      nameKo: "와이어 본딩",
      definitionMd: "가는 금속선으로 다이의 패드와 패키지 단자를 잇는 방법.",
    },
    {
      nameEn: "TSV",
      nameKo: "실리콘 관통 전극",
      fullNameEn: "Through-Silicon Via",
      primaryKind: "abbreviation",
      definitionMd: "칩을 수직으로 뚫어 위아래를 바로 잇는 전극. 쌓아 올린 칩을 짧게 연결한다.",
    },
    {
      nameEn: "HBM",
      nameKo: "고대역폭 메모리",
      fullNameEn: "High Bandwidth Memory",
      primaryKind: "abbreviation",
      definitionMd: "DRAM을 여러 층 쌓고 TSV로 이어 폭넓은 통로를 낸 메모리.",
    },
    {
      nameEn: "DRAM",
      nameKo: "디램",
      fullNameEn: "Dynamic Random-Access Memory",
      primaryKind: "abbreviation",
      definitionMd: "전하를 담아 정보를 기억하되 계속 되채워 줘야 하는 휘발성 메모리.",
    },
    {
      nameEn: "NAND flash",
      nameKo: "낸드 플래시",
      definitionMd: "전원이 꺼져도 내용이 남는 비휘발성 메모리. SSD와 저장장치에 쓰인다.",
    },
    {
      nameEn: "MOSFET",
      nameKo: "모스펫",
      fullNameEn: "Metal-Oxide-Semiconductor Field-Effect Transistor",
      primaryKind: "abbreviation",
      definitionMd: "게이트에 건 전압으로 전류 통로를 여닫는, 디지털 회로의 기본 스위치.",
    },
    {
      nameEn: "FinFET",
      nameKo: "핀펫",
      definitionMd: "채널을 지느러미처럼 세워 게이트가 세 면을 감싸게 만든 트랜지스터 구조.",
    },
    {
      nameEn: "GAA",
      nameKo: "게이트 올 어라운드",
      fullNameEn: "Gate-All-Around",
      primaryKind: "abbreviation",
      definitionMd: "게이트가 채널을 네 면 모두 감싸 누설을 더 줄인 트랜지스터 구조.",
    },
    {
      nameEn: "Threshold voltage",
      nameKo: "문턱 전압",
      definitionMd: "트랜지스터가 켜지기 시작하는 게이트 전압.",
    },
    {
      nameEn: "Leakage current",
      nameKo: "누설 전류",
      definitionMd: "꺼져 있어야 할 상태에서도 새어 흐르는 전류. 대기 전력을 좌우한다.",
    },
    {
      nameEn: "Process node",
      nameKo: "공정 노드",
      definitionMd: "3nm처럼 세대를 가리키는 이름. 실제 치수라기보다 세대 구분에 가깝다.",
    },
    {
      nameEn: "Cleanroom",
      nameKo: "클린룸",
      definitionMd: "먼지 하나가 불량이 되므로 공기 중 입자 수를 규격으로 관리하는 작업 공간.",
    },
    {
      nameEn: "Defect density",
      nameKo: "결함 밀도",
      definitionMd: "단위 면적당 결함 수. 다이가 클수록 같은 밀도에서도 수율이 더 떨어진다.",
    },
    {
      nameEn: "Wafer test",
      nameKo: "웨이퍼 테스트",
      definitionMd: "자르기 전에 웨이퍼 상태로 각 다이의 양·불량을 가려내는 검사.",
      aliases: ["EDS"],
    },
    {
      nameEn: "Burn-in",
      nameKo: "번인",
      definitionMd: "높은 온도와 전압으로 미리 돌려 초기 불량을 걸러내는 시험.",
    },
    {
      nameEn: "Tape-out",
      nameKo: "테이프아웃",
      definitionMd: "설계를 마치고 제조용 데이터를 팹에 넘기는 시점.",
    },
  ],
};

export const SEED_PACKS: readonly SeedPack[] = [GENERAL, IT, SEMICONDUCTOR];

export function packByKey(key: string): SeedPack | undefined {
  return SEED_PACKS.find((p) => p.key === key);
}
