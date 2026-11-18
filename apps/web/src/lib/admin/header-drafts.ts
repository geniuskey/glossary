export interface HeaderDraft {
  /** 화면 전용 행 식별자. 서버 스키마는 strict라 보내기 전에 headerPayload로 뺀다. */
  id: string;
  name: string;
  value: string;
  configured?: boolean;
}

export interface HeaderPayload { name: string; value: string; configured?: boolean }

let sequence = 0;

/**
 * 행 key를 이름(`${index}:${header.name}`)으로 만들면 이름 칸에 한 글자 칠 때마다
 * key가 바뀌어 React가 행을 새로 만들고, 입력 중인 칸의 포커스가 빠진다.
 * 이름과 무관한 고정 id를 행이 생길 때 한 번만 붙인다.
 */
export function newHeaderDraft(header: Partial<HeaderPayload> = {}): HeaderDraft {
  sequence += 1;
  return { id: `header-${sequence}`, name: header.name ?? "", value: header.value ?? "", ...(header.configured ? { configured: true } : {}) };
}

/** 저장된 header는 값을 다시 내려주지 않으므로 값 칸은 비워 두고 configured만 남긴다. */
export function headerDraftsOf(headers: readonly { name: string; configured?: boolean }[]): HeaderDraft[] {
  return headers.map((header) => newHeaderDraft({ name: header.name, configured: header.configured }));
}

export function headerPayload(drafts: readonly HeaderDraft[]): HeaderPayload[] {
  return drafts.map(({ name, value, configured }) => (configured ? { name, value, configured } : { name, value }));
}
