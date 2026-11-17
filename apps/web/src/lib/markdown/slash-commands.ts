import type { EditorIconName } from "@/components/markdown-editor-icons";

export interface SlashCommand {
  action: string;
  label: string;
  hint: string;
  icon: EditorIconName;
  /** 한글 초성·영문 별칭으로도 찾을 수 있게 하는 검색어 */
  keywords: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { action: "heading-1", label: "제목 1", hint: "#", icon: "view-glossary", keywords: "h1 heading title 제목 큰제목 ㅈㅁ" },
  { action: "heading-2", label: "제목 2", hint: "##", icon: "view-glossary", keywords: "h2 heading 제목 중제목 ㅈㅁ" },
  { action: "heading-3", label: "제목 3", hint: "###", icon: "view-glossary", keywords: "h3 heading 제목 소제목 ㅈㅁ" },
  { action: "bullet", label: "글머리 목록", hint: "-", icon: "bullet", keywords: "ul bullet list 목록 리스트 ㄱㅁ ㅁㄹ" },
  { action: "ordered", label: "번호 목록", hint: "1.", icon: "ordered", keywords: "ol ordered number list 목록 번호 ㅂㅎ" },
  { action: "task", label: "체크리스트", hint: "- [ ]", icon: "task", keywords: "todo task check 할일 체크 ㅊㅋ" },
  { action: "quote", label: "인용", hint: ">", icon: "quote", keywords: "quote blockquote 인용 ㅇㅇ" },
  { action: "code-block", label: "코드 블록", hint: "```", icon: "code-block", keywords: "code pre 코드 ㅋㄷ" },
  { action: "table", label: "표", hint: "| |", icon: "table", keywords: "table grid 표 테이블 ㅍ" },
  { action: "image", label: "이미지", hint: "PNG·JPG·WebP", icon: "image", keywords: "image img picture 이미지 그림 사진 ㅇㅁㅈ" },
  { action: "block-math", label: "블록 수식", hint: "$$", icon: "block-math", keywords: "math latex katex equation 수식 ㅅㅅ" },
  { action: "mermaid", label: "Mermaid 다이어그램", hint: "flowchart", icon: "mermaid", keywords: "mermaid diagram chart flow 다이어그램 도표 ㄷㅇ" },
  { action: "rule", label: "구분선", hint: "---", icon: "rule", keywords: "hr rule divider line 구분선 선 ㄱㅂ" },
];

/**
 * `/` 블록 삽입 메뉴를 띄울지 판정한다. 줄 맨 앞(들여쓰기 허용)에서 친 `/`만 명령으로
 * 본다 — 문장 중간의 `/`(날짜 2024/01, "및/또는")에서 메뉴가 뜨면 입력을 방해한다.
 */
export function slashCommandQuery(textBeforeCursor: string): { offset: number; query: string } | null {
  const match = /^(\s*)\/([^\s/]{0,20})$/.exec(textBeforeCursor);
  if (!match) return null;
  return { offset: (match[1] ?? "").length, query: (match[2] ?? "").toLowerCase() };
}

export function matchSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((command) => (
    command.label.toLowerCase().replaceAll(" ", "").includes(needle.replaceAll(" ", ""))
    || command.keywords.split(" ").some((keyword) => keyword.startsWith(needle))
  ));
}
