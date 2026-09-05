import type { Metadata } from "next";
import { InfoCard, InfoPageShell } from "@/components/info-page-shell";
import { APP_VERSION_LABEL } from "@/lib/app-version";
import { PROJECT_LINKS } from "@/lib/project-links";

export const metadata: Metadata = {
  title: "소개",
  description: "Glossary 프로젝트의 목적과 설계 원칙",
};

export default function AboutPage() {
  return (
    <InfoPageShell current="/about" eyebrow="About" title="조직의 말을 하나의 기준으로" description="Glossary는 엑셀과 문서에 흩어진 용어를 하나의 사전으로 모으고, 사람이 찾기 쉽고 도구도 읽을 수 있게 만드는 셀프호스팅 용어집 플랫폼입니다.">
      <section className="grid gap-3 md:grid-cols-3" aria-label="설계 원칙">
        <InfoCard title="개념과 표기의 분리">하나의 개념에 표준 이름, 약어, 풀네임, 별칭과 금지 표기를 함께 연결합니다.</InfoCard>
        <InfoCard title="위키형 협업">승인 절차보다 빠른 편집을 택하고, 전체 수정 이력과 되돌리기로 안전하게 관리합니다.</InfoCard>
        <InfoCard title="사람과 도구가 함께 사용">웹 검색과 표 편집뿐 아니라 OpenAPI와 조회 API로 외부 도구도 같은 사전을 사용합니다.</InfoCard>
      </section>

      <section className="mt-10 card p-6" aria-labelledby="project-heading">
        <div className="flex items-center gap-2">
          <h2 id="project-heading" className="text-base font-semibold text-ink">오픈 프로젝트</h2>
          <span className="chip" aria-label={`앱 버전 ${APP_VERSION_LABEL}`}>{APP_VERSION_LABEL}</span>
        </div>
        <p className="mt-3 text-sm leading-7 text-ink-2">소스 코드와 문서는 Apache License 2.0으로 공개합니다. 제품 데이터는 각 배포 조직의 Postgres에 저장되며 프로젝트 저장소로 전송되지 않습니다.</p>
        <p className="mt-2 text-sm leading-7 text-ink-2"><a href={PROJECT_LINKS.creator} target="_blank" rel="noreferrer" className="link">Euiyun Kim (Edwin)</a>이 만들고 관리합니다.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href={PROJECT_LINKS.repository} target="_blank" rel="noreferrer" className="btn-primary">GitHub 저장소</a>
          <a href={PROJECT_LINKS.documentation} target="_blank" rel="noreferrer" className="btn-ghost">프로젝트 문서</a>
          <a href={`${PROJECT_LINKS.repository}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer" className="btn-ghost">기여 안내</a>
          <a href={PROJECT_LINKS.license} target="_blank" rel="noreferrer" className="btn-ghost">Apache-2.0</a>
        </div>
      </section>
    </InfoPageShell>
  );
}
