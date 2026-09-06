import Link from "next/link";
import type { TermQualityOverview } from "@/lib/workspace/term-quality";
import {
  TERM_QUALITY_PROFILE_DESCRIPTION,
  TERM_QUALITY_PROFILE_LABEL,
  type ResolvedTermQualityProfile,
} from "@/lib/workspace/term-quality-values";

const PROFILES: ResolvedTermQualityProfile[] = ["mapping", "context", "guidance"];

export function TermQualityPanel({ overview }: { overview: TermQualityOverview }) {
  return (
    <section aria-labelledby="term-quality-heading">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="term-quality-heading" className="text-base font-semibold text-ink">콘텐츠 완성도</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">
            플랫폼이 용어의 표기, 상태와 내용을 보고 필요한 정보를 자동으로 판단합니다. 용어마다 기준을 따로 선택할 필요가 없습니다.
          </p>
        </div>
        <Link href="/contribute?tab=edit" className="btn-primary btn-sm shrink-0">
          {overview.incomplete > 0 ? `${overview.incomplete.toLocaleString("ko-KR")}개 보완하기` : "정리 현황 보기"}
        </Link>
      </header>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel-2/50 px-4 py-4">
          <div>
            <p className="text-xs text-ink-3">전체 완성도</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">
              {overview.complete.toLocaleString("ko-KR")}/{overview.total.toLocaleString("ko-KR")}
            </p>
          </div>
          <p className="text-xs leading-5 text-ink-2">
            {overview.incomplete > 0
              ? `${overview.incomplete.toLocaleString("ko-KR")}개 용어에 필요한 정보가 남아 있습니다.`
              : "모든 용어가 현재 기준을 충족합니다."}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-sm">
            <thead className="border-b border-line bg-panel-2/60 text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">자동 판정</th>
                <th scope="col" className="px-4 py-2.5 font-medium">필요한 정보</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">현재 결과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PROFILES.map((profile) => (
                <tr key={profile}>
                  <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-ink">{TERM_QUALITY_PROFILE_LABEL[profile]}</th>
                  <td className="px-4 py-3 text-xs leading-5 text-ink-2">{TERM_QUALITY_PROFILE_DESCRIPTION[profile]}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs tabular-nums text-ink-2">
                    {overview.profiles[profile].complete}/{overview.profiles[profile].total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line px-4 py-3 text-[11px] leading-5 text-ink-3">
          Full name이 있는 약어·식별자는 표기 매핑, 폐기·금지 용어는 사용 지침, 나머지는 맥락 설명으로 자동 판정합니다.
        </div>
      </div>
    </section>
  );
}
