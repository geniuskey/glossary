import type { WorkspaceMenuKey } from "@glossary/db";

export type ResolvedWorkspaceMenuSettings = Record<WorkspaceMenuKey, boolean>;

export interface WorkspaceMenuOption {
  key: WorkspaceMenuKey;
  label: string;
  description: string;
  alwaysOn?: boolean;
  adminOnly?: boolean;
}

export const WORKSPACE_MENU_OPTIONS: readonly WorkspaceMenuOption[] = [
  { key: "contribute", label: "함께 정리", description: "미완성 용어를 찾아 채우는 작업 공간" },
  { key: "check", label: "문서 점검", description: "문서에서 발견한 미등록 후보를 검토" },
  { key: "field-completion", label: "필드 보완", description: "정의·분류가 비어 있는 용어를 보완" },
  { key: "sheet", label: "시트", description: "용어집의 기본 표 편집 화면", alwaysOn: true },
  { key: "classifications", label: "분류 체계", description: "도메인·업무 분류를 관리" },
  { key: "graph", label: "관계도", description: "용어 사이의 맥락과 관계를 탐색" },
  { key: "chat", label: "용어 챗봇", description: "AI에게 용어집과 업무 맥락을 질문" },
  { key: "meetings", label: "회의 지식", description: "Confluence 회의록에서 지식을 승격" },
  { key: "wiki", label: "위키", description: "검토된 업무 원칙·프로세스·플레이북" },
  { key: "api", label: "API", description: "개발자 연동 문서와 API 사용 화면" },
  { key: "import", label: "가져오기", description: "엑셀로 용어를 일괄 가져오기" },
  { key: "statistics", label: "통계", description: "관리자용 운영 현황", adminOnly: true },
];

export const DEFAULT_WORKSPACE_MENU_SETTINGS: Record<WorkspaceMenuKey, boolean> = {
  contribute: true,
  check: true,
  "field-completion": true,
  sheet: true,
  classifications: true,
  graph: true,
  chat: true,
  meetings: true,
  wiki: true,
  api: true,
  import: true,
  statistics: true,
};

export function isWorkspaceMenuKey(value: string): value is WorkspaceMenuKey {
  return WORKSPACE_MENU_OPTIONS.some((item) => item.key === value);
}
