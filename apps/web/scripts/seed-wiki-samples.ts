import path from "node:path";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  createDb,
  surfaceKeys,
  termRevisions,
  termSurfaces,
  terms,
  users,
  wikiPageRevisions,
  wikiPageTerms,
  wikiPages,
  wikiRagIndexQueue,
} from "@glossary/db";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "../../../.env"));
} catch {
  // 파일이 없으면 컨테이너/셸 환경변수를 그대로 사용한다.
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL이 필요합니다.");
const db = createDb(databaseUrl);

const SAMPLE_TERMS = [
  {
    slug: "api",
    nameKo: "응용 프로그램 인터페이스",
    nameEn: "API",
    fullNameEn: "Application Programming Interface",
    definitionMd: "프로그램끼리 기능과 데이터를 주고받기 위해 정해 둔 약속된 창구입니다.",
  },
  {
    slug: "kpi",
    nameKo: "핵심성과지표",
    nameEn: "KPI",
    fullNameEn: "Key Performance Indicator",
    definitionMd: "목표를 얼마나 달성했는지 숫자로 확인하기 위해 정해 둔 지표입니다.",
  },
  {
    slug: "ci",
    nameKo: "지속적 통합",
    nameEn: "CI",
    fullNameEn: "Continuous Integration",
    definitionMd: "변경 사항을 자주 통합하고 자동 빌드와 테스트로 문제를 일찍 찾는 방식입니다.",
  },
  {
    slug: "cd",
    nameKo: "지속적 배포",
    nameEn: "CD",
    fullNameEn: "Continuous Delivery",
    definitionMd: "검증을 통과한 변경 사항을 언제든 배포할 수 있는 상태로 유지하는 방식입니다.",
  },
  {
    slug: "sso",
    nameKo: "통합 인증",
    nameEn: "SSO",
    fullNameEn: "Single Sign-On",
    definitionMd: "한 번 로그인하면 연결된 여러 서비스에 다시 로그인하지 않고 접근하는 방식입니다.",
  },
  {
    slug: "runbook",
    nameKo: "운영 절차서",
    nameEn: "Runbook",
    fullNameEn: null,
    definitionMd: "장애 대응이나 정기 운영 작업을 같은 순서와 기준으로 수행하도록 정리한 문서입니다.",
  },
] as const;

const WIKI_SAMPLES = [
  {
    slug: "release-checklist",
    title: "릴리스 체크리스트",
    summary: "서비스 변경을 안전하게 배포하기 위해 확인할 항목을 모은 샘플 문서입니다.",
    sourceUrl: "https://docs.example.com/engineering/release-checklist",
    domain: ["IT", "운영"],
    termSlugs: ["api", "ci", "cd", "kpi"],
    status: "published" as const,
    content: `## 목적

이 문서는 작은 기능 변경부터 정기 릴리스까지 공통으로 확인할 최소 기준을 설명합니다.

> 공개된 위키 문서만 AI 검색의 공식 업무 맥락으로 사용됩니다.

## 배포 전 확인

- [x] 변경 범위와 담당자를 기록한다.
- [x] **CI** 빌드와 테스트가 통과했는지 확인한다.
- [ ] API 호환성 변경이 있다면 소비자 팀에 알린다.
- [ ] 롤백 절차와 모니터링 지표를 준비한다.

| 단계 | 확인할 내용 | 담당 |
| --- | --- | --- |
| 준비 | 변경 범위, 영향도, 롤백 방법 | 개발 담당자 |
| 검증 | 자동 테스트와 주요 사용자 흐름 | QA 담당자 |
| 배포 | 점진적 노출과 오류 지표 | 운영 담당자 |

## 흐름

${"```"}mermaid
flowchart LR
  A[변경 준비] --> B[CI 검증]
  B --> C[점진적 배포]
  C --> D[지표 확인]
  D -->|문제 없음| E[전체 공개]
  D -->|문제 발생| F[롤백]
${"```"}

세부 지표는 [릴리스 대시보드](https://monitoring.example.com/releases)에서 확인합니다.`,
  },
  {
    slug: "incident-response-basics",
    title: "장애 대응 기본 절차",
    summary: "장애를 발견한 뒤 복구하고 회고하기까지의 기본 흐름을 설명하는 샘플 문서입니다.",
    sourceUrl: "https://docs.example.com/operations/incident-response",
    domain: ["운영", "보안"],
    termSlugs: ["runbook", "api", "kpi"],
    status: "published" as const,
    content: `## 먼저 할 일

장애를 발견하면 영향 범위를 추측하기보다 관측 가능한 사실을 먼저 기록합니다.

1. 담당자와 커뮤니케이션 채널을 정한다.
2. 사용자 영향과 시작 시각을 기록한다.
3. 가장 작은 안전한 조치로 확산을 멈춘다.
4. 복구 후 원인과 재발 방지 작업을 남긴다.

### 운영 명령 예시

${"```"}bash
# 실제 운영 환경에서는 승인된 Runbook의 명령만 실행한다.
curl -fsS https://status.example.com/health
${"```"}

### 성공 기준

복구 여부는 단일 요청의 성공이 아니라 오류율과 지연 시간이 정상 범위로 돌아왔는지로 판단합니다. 예를 들어 오류 예산을 다음처럼 계산할 수 있습니다.

$$
error\ budget = 1 - availability\ target
$$

장애가 종료되면 관련 로그, 타임라인, 후속 액션 아이템을 한 문서에 연결합니다.`,
  },
  {
    slug: "glossary-writing-guide",
    title: "좋은 용어·위키 문서 작성 가이드",
    summary: "용어집과 위키를 함께 사용할 때의 작성 규칙을 확인하는 초안입니다.",
    sourceUrl: "https://docs.example.com/knowledge/writing-guide",
    domain: ["일반", "IT"],
    termSlugs: ["api", "kpi", "sso"],
    status: "draft" as const,
    content: `## 용어집과 위키의 역할

용어집에는 반복해서 쓰는 표기와 짧은 정의를 넣고, 위키에는 그 용어가 실제 업무에서 언제 어떻게 쓰이는지 적습니다.

### 작성 원칙

- 한 문서에는 하나의 결정이나 절차를 중심으로 담습니다.
- 제목과 요약만 읽어도 문서의 범위를 알 수 있게 합니다.
- 외부 원문이 있으면 출처 URL을 남깁니다.
- 공개 전에는 초안으로 저장하고 다른 사람이 문맥을 확인합니다.

이 페이지는 아직 검토 전인 **초안**입니다. 팀의 실제 규칙을 반영한 뒤 공개 상태로 바꾸세요.`,
  },
] as const;

async function seedAuthorId(): Promise<string | null> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(users.createdAt)
    .limit(1);
  return admin?.id ?? null;
}

function contentHash(input: {
  title: string;
  summary: string | null;
  sourceUrl: string | null;
  content: string;
  domain: readonly string[];
  termIds: readonly string[];
}): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

const authorId = await seedAuthorId();
let termsCreated = 0;
let termsReused = 0;

for (const sample of SAMPLE_TERMS) {
  const [existing] = await db.select({ id: terms.id }).from(terms).where(eq(terms.slug, sample.slug)).limit(1);
  if (existing) {
    termsReused += 1;
    continue;
  }

  await db.transaction(async (tx) => {
    const [created] = await tx.insert(terms).values({
      slug: sample.slug,
      qualityProfile: "auto",
      nameEn: sample.nameEn,
      nameKo: sample.nameKo,
      fullNameEn: sample.fullNameEn,
      domain: ["IT"],
      category: [],
      status: "active",
      definitionMd: sample.definitionMd,
      bodyMd: null,
      createdBy: authorId,
      updatedBy: authorId,
    }).returning();
    if (!created) throw new Error(`용어를 저장하지 못했습니다: ${sample.slug}`);

    const surfaces = [
      { termId: created.id, text: sample.nameEn, lang: "en" as const, kind: "abbreviation" as const, caseSensitive: true, ...surfaceKeys(sample.nameEn) },
      { termId: created.id, text: sample.nameKo, lang: "ko" as const, kind: "canonical" as const, caseSensitive: false, ...surfaceKeys(sample.nameKo) },
      ...(sample.fullNameEn ? [{ termId: created.id, text: sample.fullNameEn, lang: "en" as const, kind: "full_name" as const, caseSensitive: false, ...surfaceKeys(sample.fullNameEn) }] : []),
    ];
    const savedSurfaces = await tx.insert(termSurfaces).values(surfaces).returning();
    await tx.insert(termRevisions).values({
      termId: created.id,
      revisionNumber: 1,
      snapshot: { term: created, surfaces: savedSurfaces },
      message: "created",
      authorId,
    });
  });
  termsCreated += 1;
}

const requestedSlugs = [...new Set(WIKI_SAMPLES.flatMap((sample) => sample.termSlugs))];
const termRows = await db.select({ id: terms.id, slug: terms.slug }).from(terms).where(inArray(terms.slug, requestedSlugs));
const termIdsBySlug = new Map(termRows.map((row) => [row.slug, row.id]));
const missingTerms = requestedSlugs.filter((slug) => !termIdsBySlug.has(slug));
if (missingTerms.length > 0) console.warn(`연결하지 못한 용어: ${missingTerms.join(", ")}`);

let pagesCreated = 0;
let pagesReused = 0;

for (const sample of WIKI_SAMPLES) {
  const [existing] = await db.select({ id: wikiPages.id }).from(wikiPages).where(eq(wikiPages.slug, sample.slug)).limit(1);
  if (existing) {
    pagesReused += 1;
    continue;
  }

  const termIds = sample.termSlugs.flatMap((slug) => {
    const id = termIdsBySlug.get(slug);
    return id ? [id] : [];
  });
  const summary = sample.summary;
  const sourceUrl = sample.sourceUrl;
  const pageHash = contentHash({
    title: sample.title,
    summary,
    sourceUrl,
    content: sample.content,
    domain: sample.domain,
    termIds,
  });
  const reviewedAt = sample.status === "published" ? new Date() : null;

  await db.transaction(async (tx) => {
    const [created] = await tx.insert(wikiPages).values({
      slug: sample.slug,
      title: sample.title,
      summary,
      sourceUrl,
      content: sample.content,
      contentHash: pageHash,
      domain: [...sample.domain],
      revision: 1,
      status: sample.status,
      createdBy: authorId,
      updatedBy: authorId,
      reviewedBy: sample.status === "published" ? authorId : null,
      reviewedAt,
    }).returning();
    if (!created) throw new Error(`위키 문서를 저장하지 못했습니다: ${sample.slug}`);

    if (termIds.length > 0) {
      await tx.insert(wikiPageTerms).values(termIds.map((termId, index) => ({
        wikiPageId: created.id,
        termId,
        role: index === 0 ? "primary" as const : "related" as const,
      })));
    }

    await tx.insert(wikiPageRevisions).values({
      wikiPageId: created.id,
      revisionNumber: 1,
      snapshot: {
        page: {
          id: created.id,
          slug: created.slug,
          title: created.title,
          summary: created.summary,
          sourceUrl: created.sourceUrl,
          content: created.content,
          contentHash: created.contentHash,
          domain: created.domain,
          revision: created.revision,
          status: created.status,
        },
        termIds,
      },
      message: "created",
      authorId,
    });
    await tx.insert(wikiRagIndexQueue).values({
      wikiPageId: created.id,
      revision: created.revision,
      status: "queued",
    });
  });
  pagesCreated += 1;
}

console.log(`위키 샘플 용어: ${termsCreated}개 추가, ${termsReused}개 재사용`);
console.log(`위키 샘플 문서: ${pagesCreated}개 추가, ${pagesReused}개 재사용`);
console.log("공개 문서 2개(release-checklist, incident-response-basics), 초안 1개(glossary-writing-guide)");
process.exit(0);
