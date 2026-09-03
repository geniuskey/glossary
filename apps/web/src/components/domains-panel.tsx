"use client";

import { Fragment, useMemo, useState } from "react";
import type { ManagedDomain } from "@/lib/terms/domains";
import { DOMAIN_COLOR_PALETTE, domainColorStyle } from "@/lib/terms/domain-colors";
import { DOMAIN_VALUE_MAX } from "@/lib/terms/limits";
import { cx } from "@/lib/ui/format";
import { HelpTip } from "./help-tip";

type Message = { kind: "ok" | "bad"; text: string } | null;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function DomainsPanel({
  initialDomains,
  initialNewLabel = "",
  isAdmin,
}: {
  initialDomains: ManagedDomain[];
  initialNewLabel?: string;
  isAdmin: boolean;
}) {
  const [domains, setDomains] = useState(initialDomains);
  const [newLabel, setNewLabel] = useState(initialNewLabel);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [paletteKey, setPaletteKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const usedColors = useMemo(() => new Set(domains.map((domain) => domain.color)), [domains]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label || busyKey) return;
    setBusyKey("__new__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "도메인을 추가하지 못했습니다"));
      const body = await response.json() as { domain: ManagedDomain };
      setDomains((current) => [...current, body.domain]);
      setNewLabel("");
      setMessage({ kind: "ok", text: `‘${body.domain.label}’ 도메인을 추가했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "도메인을 추가하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveName(domain: ManagedDomain) {
    const label = domain.label.trim();
    if (!label || busyKey) return;
    setBusyKey(domain.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "이름을 저장하지 못했습니다"));
      setMessage({ kind: "ok", text: "도메인 이름과 연결된 용어를 함께 갱신했습니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveColor(domain: ManagedDomain, color: string) {
    if (busyKey || color === domain.color) {
      setPaletteKey(null);
      return;
    }
    setBusyKey(domain.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "색상을 저장하지 못했습니다"));
      setDomains((current) => current.map((item) => item.key === domain.key ? { ...item, color } : item));
      setPaletteKey(null);
      setMessage({ kind: "ok", text: `‘${domain.label}’ 도메인 색상을 저장했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "색상을 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= domains.length || busyKey) return;
    const previous = domains;
    const reordered = [...domains];
    [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
    setDomains(reordered.map((domain, sortOrder) => ({ ...domain, sortOrder })));
    setBusyKey("__order__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/domains", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: reordered.map((domain) => domain.key) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "순서를 저장하지 못했습니다"));
    } catch (error) {
      setDomains(previous);
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "순서를 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(domain: ManagedDomain) {
    if (busyKey || (!isAdmin && domain.usageCount > 0)) return;
    const effect = domain.usageCount > 0
      ? `\n연결된 용어 ${domain.usageCount.toLocaleString("ko-KR")}개에서 이 도메인이 제거됩니다.`
      : "";
    if (!window.confirm(`‘${domain.label}’ 도메인을 삭제할까요?${effect}`)) return;
    setBusyKey(domain.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/domains/${encodeURIComponent(domain.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "도메인을 삭제하지 못했습니다"));
      setDomains((current) => current.filter((item) => item.key !== domain.key));
      setMessage({ kind: "ok", text: `‘${domain.label}’ 도메인을 삭제했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "도메인을 삭제하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section aria-labelledby="domains-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="domains-heading" className="text-base font-semibold text-ink">도메인</h2>
        <HelpTip text="용어가 속한 제품·기술·사업 영역입니다. 누구나 추가하고 미사용 항목을 삭제할 수 있으며, 이름·순서·고유 색상과 사용 중 항목 삭제는 관리자만 관리합니다." />
      </div>

      {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3", message.kind === "bad" ? "note-danger" : "note-ok")}>{message.text}</p>}

      <form onSubmit={(event) => void add(event)} className="card overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left text-sm">
          <thead><tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
            <th className="w-20 px-3 py-2 font-medium">순서</th>
            <th className="px-3 py-2 font-medium">도메인 이름</th>
            <th className="w-24 px-3 py-2 text-center font-medium">색상</th>
            <th className="w-20 px-3 py-2 text-right font-medium">사용</th>
            <th className="w-32 px-3 py-2 text-right font-medium">관리</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {domains.map((domain, index) => (
              <Fragment key={domain.key}>
              <tr className="hover:bg-panel-2/55">
                <td className="px-3 py-2">{isAdmin ? <span className="flex gap-0.5">
                  <button type="button" className="btn-quiet h-7 w-7 p-0" disabled={index === 0 || Boolean(busyKey)} onClick={() => void move(index, -1)} aria-label={`${domain.label} 위로 이동`}>↑</button>
                  <button type="button" className="btn-quiet h-7 w-7 p-0" disabled={index === domains.length - 1 || Boolean(busyKey)} onClick={() => void move(index, 1)} aria-label={`${domain.label} 아래로 이동`}>↓</button>
                </span> : <span className="font-mono text-xs text-ink-3">{index + 1}</span>}</td>
                <td className="px-3 py-2">{isAdmin
                  ? <input value={domain.label} maxLength={DOMAIN_VALUE_MAX} disabled={Boolean(busyKey)} onChange={(event) => setDomains((current) => current.map((item) => item.key === domain.key ? { ...item, label: event.target.value } : item))} className="field h-8 py-0" aria-label={`${domain.key} 이름`} />
                  : <span className="font-medium text-ink">{domain.label}</span>}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    disabled={!isAdmin || Boolean(busyKey)}
                    aria-label={`${domain.label} 색상 선택`}
                    aria-expanded={paletteKey === domain.key}
                    onClick={() => setPaletteKey((current) => current === domain.key ? null : domain.key)}
                    className="inline-grid h-7 w-10 place-items-center rounded-lg border border-line bg-panel transition hover:border-line-strong disabled:cursor-default disabled:opacity-100"
                  >
                    <span className="domain-color-swatch h-4 w-7 rounded-md" style={domainColorStyle(domain.color)} />
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-2">{domain.usageCount.toLocaleString("ko-KR")}</td>
                <td className="px-3 py-2"><span className="flex justify-end gap-1">
                  {isAdmin && <button type="button" className="btn-ghost btn-sm" disabled={!domain.label.trim() || Boolean(busyKey)} onClick={() => void saveName(domain)}>저장</button>}
                  {!isAdmin && domain.usageCount > 0
                    ? <span className="text-xs text-ink-3">관리자만</span>
                    : <button type="button" className="btn-quiet btn-sm text-danger" disabled={Boolean(busyKey)} onClick={() => void remove(domain)}>삭제</button>}
                </span></td>
              </tr>
              {isAdmin && paletteKey === domain.key && (
                <tr className="bg-panel-2/45">
                  <td colSpan={5} className="px-3 py-3">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1.5" role="group" aria-label={`${domain.label} 도메인 색상 팔레트`}>
                      {DOMAIN_COLOR_PALETTE.map((color) => {
                        const unavailable = usedColors.has(color.key) && color.key !== domain.color;
                        return (
                          <button
                            key={color.key}
                            type="button"
                            disabled={unavailable || Boolean(busyKey)}
                            aria-label={`${color.key} 색상${unavailable ? " · 다른 도메인에서 사용 중" : ""}`}
                            aria-pressed={color.key === domain.color}
                            title={unavailable ? "다른 도메인에서 사용 중" : "이 색상 사용"}
                            onClick={() => void saveColor(domain, color.key)}
                            className="grid h-8 place-items-center rounded-lg border border-transparent transition hover:border-line-strong aria-pressed:border-ink aria-pressed:bg-panel disabled:cursor-not-allowed disabled:opacity-20"
                          >
                            <span className="domain-color-swatch h-4 w-6 rounded" style={domainColorStyle(color.key)} />
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line bg-panel-2/45">
            <td className="px-3 py-2 text-xs font-semibold text-brand">추가</td>
            <td className="px-3 py-2"><label htmlFor="new-domain" className="sr-only">새 도메인 이름</label><input id="new-domain" value={newLabel} maxLength={DOMAIN_VALUE_MAX} required disabled={Boolean(busyKey)} onChange={(event) => setNewLabel(event.target.value)} placeholder="예: IT" className="field h-8 py-0" /></td>
            <td />
            <td />
            <td className="px-3 py-2 text-right"><button type="submit" className="btn-primary btn-sm" disabled={!newLabel.trim() || Boolean(busyKey)}>추가</button></td>
          </tr></tfoot>
        </table>
      </form>
    </section>
  );
}
