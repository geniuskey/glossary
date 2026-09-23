import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, surfaceKeys, termRevisions, termSurfaces, terms, users } from "@glossary/db";
import { ensureDomains } from "../src/lib/terms/domain-catalog.js";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 파일이 없으면 컨테이너/셸 환경변수를 그대로 사용한다.
}

const DEFINITION_SAMPLES = [
  ["API 게이트웨이", "API Gateway", "여러 백엔드 서비스 앞에서 클라이언트 요청을 받아 인증, 라우팅, 속도 제한, 응답 조합 같은 공통 처리를 수행하는 진입점입니다."],
  ["캐시 무효화", "Cache Invalidation", "캐시에 저장된 데이터가 더 이상 최신이 아니게 되었을 때 해당 항목을 삭제하거나 새 값으로 교체하는 처리입니다."],
  ["데이터 레이크", "Data Lake", "정형·반정형·비정형 데이터를 원래 형태에 가깝게 대규모로 저장하고 필요할 때 분석에 사용하는 저장소입니다."],
  ["데이터 웨어하우스", "Data Warehouse", "여러 업무 시스템의 데이터를 분석하기 좋은 구조로 통합해 보고서와 의사결정에 제공하는 저장소입니다."],
  ["ETL", "Extract, Transform, Load", "원천 시스템에서 데이터를 추출하고 필요한 형태로 변환한 뒤 대상 저장소에 적재하는 데이터 처리 흐름입니다."],
  ["워크플로 오케스트레이션", "Workflow Orchestration", "여러 작업의 실행 순서와 의존성, 재시도, 실패 처리를 정의해 업무 흐름을 자동으로 조정하는 방식입니다."],
  ["멀티테넌시", "Multitenancy", "하나의 애플리케이션 인스턴스가 여러 고객이나 조직의 데이터를 서로 격리하면서 함께 제공하는 운영 구조입니다."],
  ["서비스 수준 목표", "Service Level Objective", "서비스 가용성이나 응답 시간처럼 측정 가능한 신뢰성 지표에 대해 일정 기간 동안 달성하려는 목표값입니다."],
  ["오류 예산", "Error Budget", "서비스 수준 목표에서 허용한 실패나 중단의 범위로서 안정성과 기능 출시 속도의 균형을 판단하는 운영 기준입니다."],
  ["롤백", "Rollback", "새로운 변경으로 문제가 발생했을 때 시스템이나 데이터를 이전에 정상적으로 동작하던 상태로 되돌리는 조치입니다."],
  ["점진적 전달", "Progressive Delivery", "새 기능이나 버전을 전체 사용자에게 한 번에 노출하지 않고 작은 범위부터 단계적으로 확대하는 배포 방식입니다."],
  ["웹 접근성", "Web Accessibility", "장애나 사용 환경과 관계없이 다양한 사람이 웹 콘텐츠와 기능을 인식하고 조작할 수 있도록 보장하는 원칙과 실천입니다."],
  ["데이터 최소 수집", "Data Minimization", "서비스 목적을 달성하는 데 필요한 범위로만 개인정보나 운영 데이터를 수집하고 보관하는 원칙입니다."],
  ["감사 로그", "Audit Log", "누가 언제 어떤 대상에 어떤 작업을 수행했는지 기록해 보안 점검과 변경 추적에 활용하는 로그입니다."],
  ["비동기 처리", "Asynchronous Processing", "요청을 받은 작업의 완료를 기다리지 않고 결과 전달이나 후속 작업을 별도의 실행 흐름에서 처리하는 방식입니다."],
  ["배치 처리", "Batch Processing", "개별 요청마다 즉시 처리하지 않고 일정량이나 일정 시간 동안 모은 데이터를 한 번에 처리하는 방식입니다."],
  ["웹훅", "Webhook", "특정 이벤트가 발생했을 때 한 시스템이 미리 등록된 다른 시스템의 HTTP 주소로 알림을 보내는 방식입니다."],
  ["데이터베이스 샤딩", "Database Sharding", "대규모 데이터를 여러 데이터베이스 조각으로 나누고 특정 분배 기준에 따라 각 조각에 저장하는 확장 방식입니다."],
  ["읽기 복제본", "Read Replica", "주 데이터베이스의 변경 내용을 복제해 조회 요청을 분산하거나 장애 대비에 사용하는 읽기 전용 데이터베이스입니다."],
  ["검색 인덱스", "Search Index", "문서나 레코드의 검색 대상 정보를 미리 구조화해 조건과 키워드에 맞는 결과를 빠르게 찾도록 만든 자료 구조입니다."],
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
// 샘플 용어의 도메인이 분류 체계에 없으면 그 용어는 편집 화면에서 저장이 막힌다.
await ensureDomains(db, ["IT"]);
let created = 0;
let reused = 0;

for (const [index, sample] of DEFINITION_SAMPLES.entries()) {
  const [nameKo, englishName, bodyMd] = sample;
  const nameEn = nameKo === "ETL" ? "ETL" : englishName;
  const fullNameEn = nameKo === "ETL" ? englishName : null;
  const name = `정의 샘플 · ${nameKo}`;
  const [existing] = await db
    .select({ id: terms.id, slug: terms.slug })
    .from(terms)
    .where(eq(terms.nameKo, name))
    .limit(1);

  if (existing) {
    reused += 1;
    continue;
  }

  await db.transaction(async (tx) => {
    const slug = `definition-sample-${index + 1}`;
    const [inserted] = await tx.insert(terms).values({
      slug,
      qualityProfile: "auto",
      nameEn,
      nameKo: name,
      fullNameEn,
      domain: ["IT"],
      category: [],
      status: "draft",
      definitionMd: null,
      bodyMd,
      createdBy: authorId,
      updatedBy: authorId,
    }).returning();
    const surfaces = [
      { termId: inserted!.id, text: nameEn, lang: "en" as const, kind: nameKo === "ETL" ? "abbreviation" as const : "canonical" as const, caseSensitive: nameKo === "ETL", ...surfaceKeys(nameEn) },
      { termId: inserted!.id, text: name, lang: "ko" as const, kind: "canonical" as const, caseSensitive: false, ...surfaceKeys(name) },
      ...(fullNameEn ? [{ termId: inserted!.id, text: fullNameEn, lang: "en" as const, kind: "full_name" as const, caseSensitive: false, ...surfaceKeys(fullNameEn) }] : []),
    ];
    const savedSurfaces = await tx.insert(termSurfaces).values(surfaces).returning();
    await tx.insert(termRevisions).values({
      termId: inserted!.id,
      revisionNumber: 1,
      snapshot: { term: inserted, surfaces: savedSurfaces },
      message: "created",
      authorId,
    });
    return undefined;
  });
  created += 1;
}

console.log(`한줄 정의 샘플: ${DEFINITION_SAMPLES.length}개 준비됨 (${created}개 추가, ${reused}개 재사용)`);
process.exit(0);
