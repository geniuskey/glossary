/** Clipboard API가 없는 HTTP 환경에서도 버튼 클릭으로 텍스트를 복사한다. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 권한이 거부된 브라우저에서는 선택 기반 복사를 한 번 더 시도한다.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.setAttribute("aria-hidden", "true");
  input.style.position = "fixed";
  input.style.top = "0";
  input.style.opacity = "0";
  document.body.appendChild(input);

  const previousFocus = document.activeElement;
  try {
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}
