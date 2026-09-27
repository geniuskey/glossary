import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { copyText } from "../src/lib/ui/copy-text";

beforeEach(() => vi.stubGlobal("HTMLElement", class {}));
afterEach(() => vi.unstubAllGlobals());

test("Clipboard API를 사용할 수 있으면 그 경로로 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  expect(await copyText("glk_secret")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("glk_secret");
});

test.each([undefined, vi.fn().mockRejectedValue(new Error("denied"))])(
  "Clipboard API가 없거나 거부되면 선택 기반 복사로 재시도한다",
  async (writeText) => {
    const input = {
      value: "", readOnly: false, style: {},
      setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(),
      setSelectionRange: vi.fn(), remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { clipboard: writeText ? { writeText } : undefined });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(input),
      body: { appendChild }, activeElement: null, execCommand,
    });

    expect(await copyText("glk_secret")).toBe(true);
    expect(input.value).toBe("glk_secret");
    expect(input.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(input.remove).toHaveBeenCalledOnce();
  },
);

test("두 복사 경로가 실패하면 실패를 반환하고 임시 입력을 지운다", async () => {
  const input = {
    value: "", readOnly: false, style: {},
    setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(),
    setSelectionRange: vi.fn(), remove: vi.fn(),
  };
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", {
    createElement: vi.fn().mockReturnValue(input),
    body: { appendChild: vi.fn() }, activeElement: null,
    execCommand: vi.fn().mockReturnValue(false),
  });

  expect(await copyText("glk_secret")).toBe(false);
  expect(input.remove).toHaveBeenCalledOnce();
});
