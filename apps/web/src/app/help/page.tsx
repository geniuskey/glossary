import type { Metadata } from "next";
import { InfoCard, InfoPageShell } from "@/components/info-page-shell";
import { PROJECT_LINKS } from "@/lib/project-links";

export const metadata: Metadata = {
  title: "도움말",
  description: "Grossary에서 용어를 찾고 등록하고 함께 관리하는 방법",
};

export default function HelpPage() {
  return (
    <InfoPageShell current="/help" eyebrow="Help" title="무엇을 하려는지부터 찾아보세요" description="자주 쓰는 작업은 아래에서 바로 시작할 수 있습니다. 설치와 운영, API 연동은 별도 문서에서 더 자세히 다룹니다.">
      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-lg font-semibold text-ink">주요 작업</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <InfoCard title="용어 찾기" href="/">이름뿐 아니라 약어·별칭·비슷한 표기까지 검색합니다.</InfoCard>
          <InfoCard title="표에서 빠르게 편집" href="/sheet">여러 용어를 한 화면에서 필터링하고 셀을 직접 수정합니다.</InfoCard>
          <InfoCard title="새 용어 등록" href="/new">이름, 표기, 정의와 관리 정보를 한 번에 등록합니다.</InfoCard>
          <InfoCard title="미완성 용어 정리" href="/contribute">비어 있는 항목과 공개 검토를 기다리는 초안을 확인합니다.</InfoCard>
          <InfoCard title="관계 살펴보기" href="/graph">도메인·업무 분류·주제로 이어지는 용어를 관계도로 봅니다.</InfoCard>
          <InfoCard title="용어집에 질문하기" href="/chat">관련 공개 용어만 근거로 삼는 AI 챗봇에 질문합니다.</InfoCard>
          <InfoCard title="엑셀에서 가져오기" href="/import">템플릿과 미리 검증을 이용해 여러 용어를 안전하게 가져옵니다.</InfoCard>
        </div>
      </section>

      <section className="mt-10 grid gap-3 md:grid-cols-2" aria-label="추가 도움말">
        <InfoCard title="설치·운영·API 문서" href={PROJECT_LINKS.documentation} external>셀프호스팅 설치, 백업·복구, SSO와 API 계약을 확인합니다.</InfoCard>
        <InfoCard title="해결되지 않았나요?" href="/support">문제 유형에 맞는 지원 채널과 보고할 정보를 확인합니다.</InfoCard>
      </section>

      <section className="mt-10" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-lg font-semibold text-ink">자주 묻는 질문</h2>
        <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-panel px-5">
          <Faq question="수정한 내용은 바로 공개되나요?">공개 상태가 ‘초안’이면 기본 검색과 AI 조회에서 제외됩니다. ‘공개’로 바꾸면 기본 검색과 API 조회에 포함됩니다.</Faq>
          <Faq question="잘못 수정하면 되돌릴 수 있나요?">용어 상세의 수정 이력에서 이전 리비전을 확인하고 되돌릴 수 있습니다. 되돌리기도 새 리비전으로 남습니다.</Faq>
          <Faq question="같은 뜻의 약어와 별칭은 어디에 넣나요?">용어 편집의 추가 표기에서 약어·풀네임·별칭·금지 표기로 나누어 등록합니다.</Faq>
          <Faq question="대량 변경은 어떻게 하나요?">시트에서 여러 셀을 직접 수정하거나, 가져오기 화면에서 Excel·CSV 파일을 먼저 검증한 뒤 반영할 수 있습니다.</Faq>
        </div>
      </section>
    </InfoPageShell>
  );
}

function Faq({ question, children }: { question: string; children: React.ReactNode }) {
  return <details className="group py-4"><summary className="cursor-pointer list-none text-sm font-medium text-ink marker:hidden">{question}<span className="float-right text-ink-3 group-open:rotate-45">＋</span></summary><p className="mt-3 pr-8 text-sm leading-6 text-ink-2">{children}</p></details>;
}
