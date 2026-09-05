import type { Metadata } from "next";
import { InfoPageShell } from "@/components/info-page-shell";
import { PROJECT_COPYRIGHT, PROJECT_LINKS } from "@/lib/project-links";

export const metadata: Metadata = {
  title: "법적 고지",
  description: "Glossary 저작권, 소프트웨어 라이선스와 데이터 책임 안내",
};

export default function LegalPage() {
  return (
    <InfoPageShell current="/legal" eyebrow="Legal" title="소프트웨어와 데이터의 책임 범위" description="이 페이지는 프로젝트 자체와 각 셀프호스팅 배포가 관리하는 데이터를 구분해 안내합니다.">
      <div className="space-y-3">
        <LegalSection title="저작권"><p>{PROJECT_COPYRIGHT}. 프로젝트 저작권 고지는 <a href={PROJECT_LINKS.notice} target="_blank" rel="noreferrer" className="link">NOTICE</a>에서 확인할 수 있습니다.</p></LegalSection>
        <LegalSection title="소프트웨어 라이선스"><p>Glossary의 소스 코드와 문서는 <a href={PROJECT_LINKS.license} target="_blank" rel="noreferrer" className="link">Apache License 2.0</a>에 따라 사용할 수 있습니다. 사용·복제·수정·배포의 최종 조건은 저장소의 LICENSE를 따르며, 제3자 패키지는 각 패키지의 라이선스를 따릅니다.</p></LegalSection>
        <LegalSection title="용어 데이터와 첨부 파일"><p>각 조직이 등록한 용어, 계정, 첨부 파일과 수정 이력의 소유권 및 이용 책임은 해당 Glossary 배포 운영자와 조직에 있습니다.</p></LegalSection>
        <LegalSection title="개인정보와 운영"><p>Glossary는 셀프호스팅 소프트웨어이며 프로젝트가 운영 중인 인스턴스의 계정이나 용어 데이터를 수집하지 않습니다. 실제 보관 기간, 접근 권한, 백업과 삭제 정책은 각 배포 운영자가 정해야 합니다.</p></LegalSection>
        <LegalSection title="보증"><p>구체적인 보증과 책임 제한은 LICENSE의 조건을 따릅니다. 운영 환경에서는 별도의 백업, 접근 통제와 보안 업데이트 절차를 마련해야 합니다.</p></LegalSection>
      </div>
    </InfoPageShell>
  );
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card p-5 sm:p-6"><h2 className="text-sm font-semibold text-ink">{title}</h2><div className="mt-2 text-sm leading-7 text-ink-2">{children}</div></section>;
}
