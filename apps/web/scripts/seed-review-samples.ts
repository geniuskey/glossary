import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { aiReviewSuggestions, surfaceKeys, termRevisions, termSurfaces, terms, users, createDb } from "@glossary/db";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 파일이 없으면 컨테이너/셸 환경변수를 그대로 사용한다.
}

const REVIEW_GENERATOR_VERSION = 3;

const REVIEW_SAMPLES = [
  ["기능 플래그", "Feature Flag", "기능을 켜고 끄는 설정입니다.", "코드 배포 없이 특정 기능의 노출 여부를 제어하는 설정입니다.", "IT", "system"],
  ["카나리 릴리스", "Canary Release", "일부 사용자에게 먼저 배포하는 방식입니다.", "새 버전을 일부 사용자나 트래픽에 먼저 배포해 이상 여부를 확인하는 릴리스 방식입니다.", "IT", "process"],
  ["블루-그린 배포", "Blue-Green Deployment", "두 환경을 번갈아 사용하는 배포 방식입니다.", "동일한 두 운영 환경을 준비하고 트래픽을 한 번에 전환해 배포 위험을 줄이는 방식입니다.", "IT", "process"],
  ["이벤트 소싱", "Event Sourcing", "변경 이벤트를 저장하는 방식입니다.", "상태의 최종값 대신 상태를 만든 변경 이벤트를 순서대로 저장하는 데이터 기록 방식입니다.", "IT", "system"],
  ["명령·조회 책임 분리", "CQRS", "명령과 조회를 나누는 설계입니다.", "데이터를 변경하는 명령 모델과 데이터를 읽는 조회 모델을 분리하는 설계 패턴입니다.", "IT", "design"],
  ["서킷 브레이커", "Circuit Breaker", "장애가 난 서비스를 잠시 차단하는 장치입니다.", "의존 서비스의 반복 장애가 전체 시스템으로 번지지 않도록 호출을 일정 시간 차단하는 패턴입니다.", "IT", "system"],
  ["요청률 제한", "Rate Limiting", "요청 수를 제한하는 기능입니다.", "특정 사용자나 클라이언트가 일정 시간에 보낼 수 있는 요청 수를 제한하는 제어 방식입니다.", "IT", "system"],
  ["멱등성", "Idempotency", "같은 요청을 여러 번 처리해도 결과가 같은 성질입니다.", "같은 요청을 한 번 또는 여러 번 처리해도 최종 상태가 달라지지 않는 성질입니다.", "IT", "system"],
  ["옵저버빌리티", "Observability", "시스템 상태를 파악하는 능력입니다.", "로그·메트릭·트레이스로 내부 상태와 장애 원인을 외부 출력만으로 추론할 수 있는 정도입니다.", "IT", "evaluation"],
  ["분산 추적", "Distributed Tracing", "요청의 흐름을 추적하는 방법입니다.", "하나의 요청이 여러 서비스와 작업을 거치는 흐름을 하나의 추적 ID로 연결해 보는 방법입니다.", "IT", "evaluation"],
  ["데이터 계약", "Data Contract", "데이터 형식을 약속한 문서입니다.", "데이터를 주고받는 생산자와 소비자가 필드·형식·변경 규칙을 함께 약속한 명세입니다.", "IT", "organization"],
  ["스키마 레지스트리", "Schema Registry", "데이터 스키마를 관리하는 저장소입니다.", "이벤트나 메시지의 스키마 버전과 호환성을 중앙에서 등록하고 검증하는 저장소입니다.", "IT", "system"],
  ["실패 메시지 큐", "Dead Letter Queue", "처리하지 못한 메시지를 모아 두는 큐입니다.", "재시도해도 처리되지 않은 메시지를 별도로 보관해 원인 분석과 수동 복구를 가능하게 하는 큐입니다.", "IT", "system"],
  ["변경 데이터 캡처", "Change Data Capture", "데이터 변경을 추적하는 방식입니다.", "데이터베이스의 삽입·수정·삭제 변경을 읽어 다른 시스템으로 전달하는 방식입니다.", "IT", "system"],
  ["피처 스토어", "Feature Store", "머신러닝 데이터를 저장하는 공간입니다.", "머신러닝 모델 학습과 추론에 사용하는 피처를 일관된 형태로 저장하고 제공하는 시스템입니다.", "IT", "system"],
  ["데이터 드리프트", "Data Drift", "시간이 지나 데이터 분포가 바뀌는 현상입니다.", "운영 환경에 유입되는 데이터의 분포가 학습 시점과 달라져 모델 성능에 영향을 주는 현상입니다.", "IT", "evaluation"],
  ["모델 레지스트리", "Model Registry", "모델 버전을 관리하는 저장소입니다.", "머신러닝 모델의 버전·상태·메타데이터를 등록하고 배포 이력을 관리하는 저장소입니다.", "IT", "system"],
  ["프롬프트 인젝션", "Prompt Injection", "프롬프트를 조작하는 공격입니다.", "사용자 입력이나 문서에 숨긴 지시로 모델의 원래 작업 규칙을 우회하려는 공격 기법입니다.", "IT", "evaluation"],
  ["검색 증강 생성", "Retrieval-Augmented Generation", "검색 결과를 활용해 답변을 만드는 방식입니다.", "외부 문서나 지식 저장소에서 관련 근거를 검색한 뒤 그 내용을 바탕으로 답변을 생성하는 방식입니다.", "IT", "system"],
  ["임베딩", "Embedding", "텍스트를 숫자 벡터로 바꾸는 표현입니다.", "텍스트나 이미지의 의미적 특징을 비교할 수 있도록 고정 길이 숫자 벡터로 변환한 표현입니다.", "IT", "system"],
  ["벡터 데이터베이스", "Vector Database", "벡터를 저장하고 검색하는 데이터베이스입니다.", "임베딩 벡터를 저장하고 의미적으로 가까운 데이터를 유사도 기준으로 검색하는 데이터베이스입니다.", "IT", "system"],
  ["토큰 예산", "Token Budget", "모델 호출에 사용할 토큰 양입니다.", "한 번의 모델 호출에서 입력과 출력에 사용할 수 있도록 미리 제한한 토큰 수입니다.", "IT", "evaluation"],
  ["안전 제약", "Guardrail", "위험한 동작을 막는 규칙입니다.", "모델이나 사용자의 입력·출력을 검사해 허용되지 않은 동작과 내용을 차단하는 제어 규칙입니다.", "IT", "process"],
  ["사람 검토 단계", "Human in the Loop", "사람이 중간에 결과를 확인하는 절차입니다.", "자동화된 판단이나 생성 결과를 사람이 확인하고 승인해야 다음 단계로 진행하는 운영 절차입니다.", "일반", "process"],
  ["미러 트래픽", "Shadow Traffic", "실제 요청을 복사해 보내는 방식입니다.", "실제 사용자 요청을 새 시스템에 복사해 보내되 그 응답은 사용자에게 반환하지 않는 검증 방식입니다.", "IT", "evaluation"],
  ["백프레셔", "Backpressure", "처리 속도 차이를 조절하는 신호입니다.", "생산자가 소비자의 처리 속도를 초과할 때 입력량을 늦추거나 버퍼를 조절하는 흐름 제어 방식입니다.", "IT", "system"],
  ["아이덴티티 제공자", "Identity Provider", "사용자 인증을 담당하는 시스템입니다.", "사용자의 신원을 확인하고 애플리케이션에 인증 결과와 계정 정보를 전달하는 시스템입니다.", "IT", "organization"],
  ["제로 트러스트", "Zero Trust", "아무도 기본적으로 믿지 않는 보안 원칙입니다.", "네트워크 안팎의 위치만으로 신뢰하지 않고 모든 접근을 지속적으로 검증하는 보안 원칙입니다.", "IT", "process"],
  ["서비스 메시", "Service Mesh", "서비스 간 통신을 관리하는 인프라 계층입니다.", "애플리케이션 코드 밖에서 서비스 간 통신의 보안·관측·재시도를 관리하는 인프라 계층입니다.", "IT", "system"],
  ["운영 절차서", "Runbook", "반복 작업을 적어 둔 문서입니다.", "장애 대응이나 정기 운영 작업을 같은 순서와 기준으로 수행할 수 있게 정리한 실행 문서입니다.", "일반", "process"],
] as const;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다.");
const db = createDb(databaseUrl);

async function seedAuthorId(): Promise<string | null> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(users.createdAt)
    .limit(1);
  return admin?.id ?? null;
}

const authorId = await seedAuthorId();
let created = 0;
let reused = 0;

for (const [index, sample] of REVIEW_SAMPLES.entries()) {
  const [nameKo, fullNameEn, currentDefinition, proposedDefinition, domain, category] = sample;
  const [existing] = await db
    .select({ id: terms.id, slug: terms.slug })
    .from(terms)
    .where(eq(terms.nameKo, `검토 샘플 · ${nameKo}`))
    .limit(1);

  const term = existing ?? await db.transaction(async (tx) => {
    const name = `검토 샘플 · ${nameKo}`;
    const bodyMd = `${fullNameEn}의 사용 맥락과 판단 기준을 확인하기 위한 검토 샘플 본문입니다. 실제 운영 문서에서 이 용어가 사용되는 상황을 설명하는 근거로 활용합니다.`;
    const slug = `review-sample-${index + 1}`;
    const [inserted] = await tx.insert(terms).values({
      slug,
      qualityProfile: "auto",
      nameKo: name,
      fullNameEn,
      domain: [],
      category: [],
      status: "draft",
      definitionMd: currentDefinition,
      bodyMd,
      createdBy: authorId,
      updatedBy: authorId,
    }).returning();
    const surfaces = [
      { termId: inserted!.id, text: name, lang: "ko" as const, kind: "canonical" as const, caseSensitive: false, ...surfaceKeys(name) },
      { termId: inserted!.id, text: fullNameEn, lang: "en" as const, kind: "full_name" as const, caseSensitive: false, ...surfaceKeys(fullNameEn) },
    ];
    const savedSurfaces = await tx.insert(termSurfaces).values(surfaces).returning();
    await tx.insert(termRevisions).values({
      termId: inserted!.id,
      revisionNumber: 1,
      snapshot: { term: inserted, surfaces: savedSurfaces },
      message: "created",
      authorId,
    });
    return { id: inserted!.id, slug: inserted!.slug };
  });
  if (existing) reused += 1;
  else created += 1;

  const [revisionRow] = await db
    .select({ revision: sql<number>`coalesce(max(${termRevisions.revisionNumber}), 0)::int` })
    .from(termRevisions)
    .where(eq(termRevisions.termId, term.id));
  const revision = revisionRow?.revision ?? 1;
  const suggestions = [
    {
      id: `sample-review-${index + 1}-definition`,
      field: "definitionMd" as const,
      value: proposedDefinition,
      reason: `샘플 근거: 본문의 ${fullNameEn} 설명을 한 문장으로 구체화했습니다.`,
      source: "agent" as const,
    },
    {
      id: `sample-review-${index + 1}-domain`,
      field: "domain" as const,
      value: [domain],
      reason: `샘플 분류: ${fullNameEn}은(는) ${domain} 맥락에서 주로 사용됩니다.`,
      source: "agent" as const,
    },
    {
      id: `sample-review-${index + 1}-category`,
      field: "category" as const,
      value: [category],
      reason: `샘플 분류: ${fullNameEn}의 업무 성격을 ${category}로 분류했습니다.`,
      source: "agent" as const,
    },
  ];

  await db.insert(aiReviewSuggestions).values({
    termId: term.id,
    revision,
    generatorVersion: REVIEW_GENERATOR_VERSION,
    suggestions,
  }).onConflictDoUpdate({
    target: aiReviewSuggestions.termId,
    set: { revision, generatorVersion: REVIEW_GENERATOR_VERSION, suggestions, generatedAt: new Date() },
  });
}

console.log(`제안 검토 샘플: ${REVIEW_SAMPLES.length}개 준비됨 (${created}개 추가, ${reused}개 재사용)`);
process.exit(0);
