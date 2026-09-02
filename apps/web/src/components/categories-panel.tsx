"use client";

import { useState } from "react";
import type { ManagedBusinessCategory } from "@/lib/terms/categories";
import { cx } from "@/lib/ui/format";
import { HelpTip } from "./help-tip";

type Message = { kind: "ok" | "bad"; text: string } | null;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function CategoriesPanel({
  initialCategories,
  initialNewLabel = "",
  isAdmin,
}: {
  initialCategories: ManagedBusinessCategory[];
  initialNewLabel?: string;
  isAdmin: boolean;
}) {
  const [categories, setCategories] = useState(initialCategories);
  const typedInKorean = /[가-힣]/.test(initialNewLabel);
  const [newLabelKo, setNewLabelKo] = useState(typedInKorean ? initialNewLabel : "");
  const [newLabelEn, setNewLabelEn] = useState(typedInKorean ? "" : initialNewLabel);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const labelKo = newLabelKo.trim();
    const labelEn = newLabelEn.trim();
    if (!labelKo || !labelEn || busyKey) return;
    setBusyKey("__new__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelKo, labelEn }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 추가하지 못했습니다"));
      const body = await response.json() as { category: ManagedBusinessCategory };
      setCategories((current) => [...current, body.category]);
      setNewLabelKo("");
      setNewLabelEn("");
      setMessage({ kind: "ok", text: `‘${body.category.labelKo}’ 업무 분류를 추가했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 추가하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  function editName(key: string, field: "labelKo" | "labelEn", value: string) {
    setCategories((current) => current.map((category) => category.key === key
      ? { ...category, [field]: value, ...(field === "labelKo" ? { label: value } : {}) }
      : category));
    setMessage(null);
  }

  async function saveNames(category: ManagedBusinessCategory) {
    const labelKo = category.labelKo.trim();
    const labelEn = category.labelEn.trim();
    if (!labelKo || !labelEn || busyKey) return;
    setBusyKey(category.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ labelKo, labelEn }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "이름을 저장하지 못했습니다"));
      setCategories((current) => current.map((item) => item.key === category.key
        ? { ...item, label: labelKo, labelKo, labelEn }
        : item));
      setMessage({ kind: "ok", text: "업무 분류 이름을 저장했습니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= categories.length || busyKey) return;
    const previous = categories;
    const reordered = [...categories];
    [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
    setCategories(reordered.map((category, sortOrder) => ({ ...category, sortOrder })));
    setBusyKey("__order__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: reordered.map((category) => category.key) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "순서를 저장하지 못했습니다"));
    } catch (error) {
      setCategories(previous);
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "순서를 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(category: ManagedBusinessCategory) {
    if (busyKey || (!isAdmin && category.usageCount > 0)) return;
    const effect = category.usageCount > 0
      ? `\n연결된 용어 ${category.usageCount.toLocaleString("ko-KR")}개는 미분류로 전환됩니다.`
      : "";
    if (!window.confirm(`‘${category.labelKo}’ 업무 분류를 삭제할까요?${effect}`)) return;
    setBusyKey(category.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 삭제하지 못했습니다"));
      setCategories((current) => current.filter((item) => item.key !== category.key));
      setMessage({ kind: "ok", text: `‘${category.labelKo}’ 업무 분류를 삭제했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 삭제하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section id="business-categories" className="scroll-mt-6" aria-labelledby="categories-heading">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="categories-heading" className="text-base font-semibold text-ink">업무 분류</h2>
        <HelpTip text="누구나 분류를 추가하고 미사용 분류를 삭제할 수 있습니다. 사용 중인 분류의 삭제와 이름·순서 변경은 관리자만 할 수 있습니다." />
      </div>

      {message && (
        <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mb-3", message.kind === "bad" ? "note-danger" : "note-ok")}>
          {message.text}
        </p>
      )}

      <form onSubmit={(event) => void addCategory(event)} className="card overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-ink-3">
              <th scope="col" className="w-20 px-3 py-2 font-medium">순서</th>
              <th scope="col" className="px-3 py-2 font-medium">한글 이름</th>
              <th scope="col" className="px-3 py-2 font-medium">English name</th>
              <th scope="col" className="w-20 px-3 py-2 text-right font-medium">사용</th>
              <th scope="col" className="w-32 px-3 py-2 text-right font-medium">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {categories.map((category, index) => (
              <tr key={category.key} className="hover:bg-panel-2/55">
                <td className="px-3 py-2">
                  {isAdmin ? (
                    <div className="flex items-center gap-0.5">
                      <button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || Boolean(busyKey)} className="btn-quiet h-7 w-7 p-0" aria-label={`${category.labelKo} 위로 이동`}>↑</button>
                      <button type="button" onClick={() => void move(index, 1)} disabled={index === categories.length - 1 || Boolean(busyKey)} className="btn-quiet h-7 w-7 p-0" aria-label={`${category.labelKo} 아래로 이동`}>↓</button>
                    </div>
                  ) : (
                    <span className="font-mono text-xs tabular-nums text-ink-3">{index + 1}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {isAdmin ? (
                    <input value={category.labelKo} onChange={(event) => editName(category.key, "labelKo", event.target.value)} maxLength={60} disabled={Boolean(busyKey)} aria-label={`${category.key} 한글 이름`} className="field h-8 py-0" />
                  ) : <span className="font-medium text-ink">{category.labelKo}</span>}
                </td>
                <td className="px-3 py-2">
                  {isAdmin ? (
                    <input value={category.labelEn} onChange={(event) => editName(category.key, "labelEn", event.target.value)} maxLength={60} disabled={Boolean(busyKey)} aria-label={`${category.key} 영문 이름`} className="field h-8 py-0" />
                  ) : <span className="text-ink-2">{category.labelEn}</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-2">{category.usageCount.toLocaleString("ko-KR")}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isAdmin && (
                      <button type="button" onClick={() => void saveNames(category)} disabled={!category.labelKo.trim() || !category.labelEn.trim() || Boolean(busyKey)} className="btn-ghost btn-sm">저장</button>
                    )}
                    {!isAdmin && category.usageCount > 0 ? (
                      <span className="text-xs text-ink-3">관리자만</span>
                    ) : (
                      <button type="button" onClick={() => void remove(category)} disabled={Boolean(busyKey)} className="btn-quiet btn-sm text-danger">삭제</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-panel-2/45">
              <td className="px-3 py-2 text-xs font-semibold text-brand">추가</td>
              <td className="px-3 py-2">
                <label htmlFor="new-category-ko" className="sr-only">새 업무 분류 한글 이름</label>
                <input id="new-category-ko" value={newLabelKo} onChange={(event) => setNewLabelKo(event.target.value)} maxLength={60} required disabled={Boolean(busyKey)} placeholder="예: 보안" className="field h-8 py-0" />
              </td>
              <td className="px-3 py-2">
                <label htmlFor="new-category-en" className="sr-only">새 업무 분류 영문 이름</label>
                <input id="new-category-en" value={newLabelEn} onChange={(event) => setNewLabelEn(event.target.value)} maxLength={60} required disabled={Boolean(busyKey)} placeholder="e.g. Security" className="field h-8 py-0" />
              </td>
              <td />
              <td className="px-3 py-2 text-right">
                <button type="submit" disabled={!newLabelKo.trim() || !newLabelEn.trim() || Boolean(busyKey)} className="btn-primary btn-sm">추가</button>
              </td>
            </tr>
          </tfoot>
        </table>
      </form>
    </section>
  );
}
