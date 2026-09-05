import type { Metadata } from "next";
import { InfoCard, InfoPageShell } from "@/components/info-page-shell";
import { PROJECT_LINKS } from "@/lib/project-links";

export const metadata: Metadata = {
  title: "지원",
  description: "Glossary 사용, 오류, 기능 제안과 보안 문제 지원 채널",
};

export default function SupportPage() {
  return (
    <InfoPageShell current="/support" eyebrow="Support" title="문제에 맞는 채널로 알려주세요" description="Glossary는 셀프호스팅 소프트웨어입니다. 계정과 데이터, 서버 운영 문제는 먼저 해당 배포의 관리자에게 문의하고, 제품 자체의 오류와 제안은 GitHub에 남겨 주세요.">
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoCard title="사용 방법과 운영 문서" href={PROJECT_LINKS.documentation} external>설치, 환경 변수, 백업·복구, SSO와 API 사용법을 검색합니다.</InfoCard>
        <InfoCard title="버그 신고" href={PROJECT_LINKS.newBug} external>재현 절차, 기대한 결과, 실제 결과와 실행 환경을 이슈로 남깁니다.</InfoCard>
        <InfoCard title="기능 제안" href={PROJECT_LINKS.newFeature} external>해결하려는 문제와 실제 사용 흐름을 중심으로 제안합니다.</InfoCard>
        <InfoCard title="보안 취약점 비공개 신고" href={PROJECT_LINKS.securityAdvisory} external>공개 이슈를 만들지 말고 GitHub Security Advisory로 제보합니다.</InfoCard>
      </div>

      <section className="mt-10 card p-5 sm:p-6" aria-labelledby="report-heading">
        <h2 id="report-heading" className="text-base font-semibold text-ink">빠르게 확인하려면 함께 적어 주세요</h2>
        <ul className="mt-4 grid gap-2 text-sm leading-6 text-ink-2 sm:grid-cols-2">
          <li>• 문제가 발생한 화면과 작업</li>
          <li>• 재현 가능한 최소 단계</li>
          <li>• 기대한 결과와 실제 결과</li>
          <li>• 브라우저·Node.js·배포 방식</li>
          <li>• 관련 로그와 오류 메시지</li>
          <li>• 민감 정보를 제거한 설정값</li>
        </ul>
        <p className="mt-4 border-t border-line pt-4 text-xs leading-5 text-danger">비밀번호, 세션 쿠키, API 키, SSO client secret, 실제 사내 용어 데이터는 이슈에 첨부하지 마세요.</p>
      </section>
    </InfoPageShell>
  );
}
