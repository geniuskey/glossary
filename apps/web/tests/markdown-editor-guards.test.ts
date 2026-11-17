import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { buildLivePreviewDecorations } from "@/lib/markdown/live-preview";
import { parseLiveTable, serializeLiveTable } from "@/components/markdown-live-table";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(testDir, "..", "src", "components", "markdown-editor.tsx"), "utf8");
const editorSource = source.replace(/\r\n/g, "\n");
const tableSource = readFileSync(path.join(testDir, "..", "src", "components", "markdown-live-table.tsx"), "utf8").replace(/\r\n/g, "\n");
const livePreviewSource = readFileSync(path.join(testDir, "..", "src", "lib", "markdown", "live-preview.ts"), "utf8").replace(/\r\n/g, "\n");

test("Markdown 편집기는 화면을 채우는 전체 화면 모드를 제공한다", () => {
  expect(source).toContain('data-markdown-fullscreen={fullscreen}');
  expect(source).toContain('fixed inset-0 z-[100]');
  expect(source).toContain('h-[100dvh]');
  expect(source).toContain('aria-modal={fullscreen || undefined}');
});

test("전체 화면은 Esc로 닫히고 배경 스크롤을 복원한다", () => {
  expect(source).toContain('event.key !== "Escape"');
  expect(source).toContain('setFullscreen(false)');
  expect(source).toContain('document.body.style.overflow = "hidden"');
  expect(source).toContain('document.body.style.overflow = previousOverflow');
});

test("본문 편집과 미리보기는 한 번에 하나만 보여 빈 패널을 만들지 않는다", () => {
  expect(source).toContain('mode === "preview" ? "hidden" : "block"');
  expect(source).toContain('mode === "glossary" ? "서식 편집 Markdown 편집기" : "텍스트 Markdown 편집기"');
  expect(source).toContain('mode === "preview" ? "block" : "hidden"');
  // 크기 조절 모드는 부모 높이를 채우고, 그 밖에서는 빈 편집기도 최소 높이를 지킨다.
  expect(source).toContain('minHeight: resizable ? "0" : compact ? "10rem" : "16rem"');
  expect(source).not.toContain('minHeight: "26rem"');
});

test("Markdown 입력 영역에는 접근 가능한 이름이 있다", () => {
  expect(source).toContain('EditorView.contentAttributes.of({');
  expect(source).toContain('"aria-label": label');
  expect(source).toContain('"aria-describedby": describedBy');
});

test("에디터 설정은 compartment로 갱신하고 보기 전환은 라이브 프리뷰를 동기화한다", () => {
  expect(editorSource).toContain("new Compartment()");
  expect(editorSource).toContain("readOnlyCompartmentRef.current.reconfigure");
  expect(editorSource).toContain("attributesCompartmentRef.current.reconfigure");
  expect(editorSource).toContain("livePreviewCompartmentRef.current.reconfigure");
  expect(editorSource).toContain("}, [compact, resizable]);");
});

test("Markdown 최대 길이는 입력 단계에서 제한하고 도달 상태를 알린다", () => {
  expect(editorSource).toContain("EditorState.changeFilter.of");
  expect(editorSource).toContain("transaction.newDoc.length <= limit");
  expect(editorSource).toContain('value.length >= maxLength ? " · 최대 글자 수" : ""');
  expect(editorSource).toContain('aria-live="polite"');
});

test("기울임은 한국어 조사가 바로 붙어도 적용하고, 업로드 자리표시자는 원문 대신 진행 표시로 보인다", () => {
  const doc = "앞\n**SoC**(System on Chip)는 칩에 *CPU·GPU*를 통합한 snake_case_name\n<!-- glossary-image-upload-1-0 -->";
  const state = EditorState.create({ doc, selection: { anchor: 0 } });
  const marked: string[] = [];
  const widgets: string[] = [];
  buildLivePreviewDecorations(state).between(0, doc.length, (from, to, decoration) => {
    if (decoration.spec.class === "cm-live-emphasis") marked.push(doc.slice(from, to));
    if (decoration.spec.widget?.className) widgets.push(decoration.spec.widget.className);
  });
  expect(marked).toEqual(["CPU·GPU"]);
  expect(widgets).toContain("cm-live-upload");
  expect(editorSource).toContain("glossary-image-upload-${Date.now()}");
  expect(livePreviewSource).toContain("export const UPLOAD_MARKER_LINE = /^<!-- glossary-image-upload-");
});

test("비동기 이미지 업로드는 원래 삽입 위치의 marker를 치환한다", () => {
  expect(editorSource).toContain("glossary-image-upload-");
  expect(editorSource).toContain("replaceUploadMarker(marker");
  expect(editorSource).toContain("await Promise.all(files.map");
  expect(editorSource).not.toContain('snippets.join("\\n")');
});

test("CodeMirror 포커스에는 눈에 보이는 대체 포커스 표시가 있다", () => {
  // 편집 영역의 outline을 지운 대신 셸(테두리 있는 경우)이나 툴바 아래 선(embedded)으로 보인다.
  expect(editorSource).toContain('"&.cm-focused": { boxShadow: "none", outline: "none" }');
  const css = readFileSync(path.join(testDir, "..", "src", "app", "globals.css"), "utf8");
  expect(css).toContain('.markdown-editor-shell[data-embedded="false"]:has(.cm-focused)');
  expect(css).toContain('.markdown-editor-shell[data-embedded="true"]:has(.cm-focused) .markdown-editor-toolbar');
  expect(editorSource).toContain("data-embedded={embedded}");
});

test("카드에 포함된 Markdown 편집기는 자체 카드 테두리를 제거할 수 있다", () => {
  expect(source).toContain("embedded = false");
  expect(source).toContain('!embedded && "rounded-xl border border-line"');
});

test("Markdown 툴바는 H1~H6와 주요 GFM 블록을 선택 영역에 적용한다", () => {
  expect(source).toContain('role="toolbar"');
  expect(source).toContain('[1, 2, 3, 4, 5, 6].map');
  expect(source).toContain('toggleListMarkdown(text, from, to, "task")');
  expect(source).toContain('toggleCodeBlockMarkdown');
  expect(source).toContain('insertMarkdownBlock');
});

test("Markdown 툴바는 수식과 Mermaid 예제를 삽입한다", () => {
  expect(source).toContain('{ action: "inline-math", label: "인라인 수식"');
  expect(source).toContain('{ action: "block-math", label: "블록 수식"');
  expect(source).toContain('{ action: "mermaid", label: "Mermaid 다이어그램"');
  expect(source).toContain('```mermaid');
  expect(source).toContain('\\\\sum_{i=1}^{n}');
});

test("자주 쓰는 인라인 서식과 제목에는 키보드 단축키가 있다", () => {
  for (const key of ["Mod-B", "Mod-I", "Mod-K", "Mod-Shift-X", "Mod-E", "Mod-Shift-7", "Mod-Shift-8", "Mod-Shift-9"]) {
    expect(source).toContain(`shortcut: "${key}"`);
  }
  expect(source).toContain("key: `Mod-Alt-${level}`, action: `heading-${level}`");
  expect(source).toContain('{ key: "Mod-Alt-0", action: "paragraph" }');
  // Mod-I는 defaultKeymap의 selectParentSyntax와 겹친다. 서식 단축키가 이겨야 한다.
  expect(source).toContain("Prec.highest(keymap.of([");
  // 목록 밖의 Tab은 포커스 이동으로 남겨야 키보드 사용자가 편집기를 빠져나갈 수 있다.
  expect(source).toContain("indentListMarkdown(");
  expect(source).not.toContain("indentWithTab");
});

test("서식 편집은 한 화면 인라인 라이브 프리뷰를 사용한다", () => {
  expect(editorSource).toContain('mode === "glossary"\n    ? [livePreviewExtension');
  expect(editorSource).toContain('서식 편집');
  expect(editorSource).toContain('미리보기');
  expect(editorSource).not.toContain("grid-rows-[minmax(12rem,1fr)_minmax(12rem,1fr)]");
  expect(editorSource).not.toContain("커서가 있는 줄에서 Markdown 원문을 편집합니다");
  // 서식 편집은 문서처럼 보여야 하므로 줄 번호·현재 줄 강조는 텍스트 모드에만 둔다.
  expect(editorSource).toContain(': [lineNumbers(), highlightActiveLine(), highlightActiveLineGutter()');
  expect(editorSource).not.toMatch(/import \{[^}]*basicSetup/);
  // defaultHighlightStyle은 제목에 밑줄을 긋는다.
  expect(editorSource).toContain("syntaxHighlighting(markdownHighlight)");
  expect(livePreviewSource).toContain("function activeLineNumbers");
  expect(livePreviewSource).toContain("function selectedLineNumbers");
  expect(livePreviewSource).toContain("if (active.has(number)) {");
  expect(livePreviewSource).toContain("HIDDEN_MARKUP");
  expect(livePreviewSource).toContain("StateField.define<DecorationSet>");
  expect(livePreviewSource).not.toContain("ViewPlugin");
  expect(livePreviewSource).toContain("cm-live-preview-edit");
  expect(livePreviewSource).toContain("cm-live-preview-add-paragraph");
  expect(livePreviewSource).toContain("표 아래에 문단 추가");
  expect(livePreviewSource).toContain("tableEnd === state.doc.lines");
  expect(livePreviewSource).toContain("lineNumberWidgetMarker");
  expect(livePreviewSource).toContain("LivePreviewLineNumberMarker");
  expect(livePreviewSource).toContain("if (root) setTimeout(() => root.unmount(), 0);");
});

test("툴바 명령은 서식 편집 중에 텍스트 모드로 튕겨 내지 않는다", () => {
  expect(editorSource).not.toContain('setMode("text");');
  expect(editorSource).toContain("pendingCommandRef.current = command;");
  expect(editorSource).toContain("setMode(lastEditModeRef.current);");
});

test("메뉴는 resize-y 셸에 잘리지 않도록 body로 portal한다", () => {
  const menuSource = readFileSync(path.join(testDir, "..", "src", "components", "markdown-editor-menu.tsx"), "utf8");
  expect(menuSource).toContain("createPortal(menu, document.body)");
  expect(menuSource).toContain('role="menu"');
  expect(menuSource).toContain('"menuitemradio" : "menuitem"');
  expect(editorSource).toContain("tooltips({ parent: document.body })");
});

test("Markdown 제목과 서식은 메뉴바에 표시하고 보기 방식은 세그먼트로 전환한다", () => {
  expect(editorSource).toContain('role="toolbar"\n        aria-label="Markdown 서식 도구"');
  expect(editorSource).toContain('label="블록 종류"');
  expect(editorSource).toContain('...[1, 2, 3, 4, 5, 6].map((level) => ({');
  expect(editorSource).toContain('label: `제목 ${level}`');
  expect(editorSource).toContain('checked: format.heading === level');
  expect(editorSource).toContain('aria-label="글자 서식"');
  expect(editorSource).toContain('aria-label="문단 서식"');
  expect(editorSource).toContain('label="삽입"');
  expect(editorSource).toContain('label="서식 더보기"');
  expect(editorSource).toContain('aria-label="본문 보기 방식"');
  expect(editorSource).toContain('aria-pressed={mode === item.value}');
  expect(editorSource).toContain('{ value: "glossary", label: "서식 편집"');
  expect(editorSource).toContain('{ value: "text", label: "텍스트"');
  expect(editorSource).toContain('{ value: "preview", label: "미리보기"');
  // 네이티브 select는 메뉴 항목에 아이콘·단축키·현재 상태를 보여 줄 수 없었다.
  expect(editorSource).not.toMatch(/<select\b/);
  // 커서 위치의 서식을 툴바가 눌린 상태로 보여 준다.
  expect(editorSource).toContain("aria-pressed={item.state ? active : undefined}");
  expect(editorSource).toContain("formatStateOf(update.state)");
  expect(editorSource).toContain('ref={fullscreenButtonRef}');
});

test("커서가 있는 줄만 Markdown 원문을 유지한다", () => {
  const doc = "# 제목\n\n**굵게** [링크](https://example.com)\n- [ ] 목록";
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf("\n") + 1 } });
  const decorations = buildLivePreviewDecorations(state);
  const classes: string[] = [];
  decorations.between(0, doc.length, (_from, _to, decoration) => {
    if (typeof decoration.spec.class === "string") classes.push(decoration.spec.class);
  });

  expect(classes).toContain("cm-live-heading-1");
  expect(classes).toContain("cm-live-strong");
  expect(classes).toContain("cm-live-link");
  expect(classes).toContain("cm-live-list");

  const firstLineState = EditorState.create({ doc, selection: { anchor: 0 } });
  const firstLineDecorations = buildLivePreviewDecorations(firstLineState);
  const firstLineClasses: string[] = [];
  firstLineDecorations.between(0, firstLineState.doc.line(1).to, (_from, _to, decoration) => {
    if (typeof decoration.spec.class === "string") firstLineClasses.push(decoration.spec.class);
  });
  expect(firstLineClasses).toContain("cm-live-heading-1");
});

test("제목을 편집하는 동안 # 개수에 맞는 스타일을 바로 적용하고 원문을 유지한다", () => {
  for (let level = 1; level <= 6; level += 1) {
    const doc = `${"#".repeat(level)} 제목`;
    const state = EditorState.create({ doc, selection: { anchor: level } });
    const ranges: Array<{ from: number; to: number; className: unknown }> = [];
    buildLivePreviewDecorations(state).between(0, doc.length, (from, to, decoration) => {
      ranges.push({ from, to, className: decoration.spec.class });
    });

    expect(ranges).toEqual([{ from: 0, to: doc.length, className: `cm-live-heading-${level}` }]);
  }
});

test("텍스트를 선택하는 동안에는 Markdown 문법이 인덴트처럼 다시 나타나지 않는다", () => {
  const doc = "# 제목\n\n**굵게** [링크](https://example.com)\n- [ ] 목록";
  const from = doc.indexOf("굵게");
  const state = EditorState.create({ doc, selection: { anchor: from, head: from + "굵게".length } });
  const classes: string[] = [];
  const decorations = buildLivePreviewDecorations(state);
  decorations.between(0, doc.length, (_from, _to, decoration) => {
    if (typeof decoration.spec.class === "string") classes.push(decoration.spec.class);
  });

  expect(classes).toContain("cm-live-strong");
});

test("내부 첨부 이미지는 Markdown 원문 대신 이미지 미리보기 위젯으로 교체한다", () => {
  const hash = "a".repeat(64);
  const doc = `설명\n\n![도표](/api/v1/attachments/${hash})`;
  const state = EditorState.create({ doc, selection: { anchor: 0 } });
  const widgets: string[] = [];
  const decorations = buildLivePreviewDecorations(state);
  decorations.between(0, doc.length, (_from, _to, decoration) => {
    if (decoration.spec.widget) widgets.push(decoration.spec.widget.constructor.name);
  });

  expect(widgets).toContain("LivePreviewImageWidget");
  expect(livePreviewSource).toContain("isInternalAttachmentUrl");
  expect(editorSource).toContain('".cm-live-preview-image":');
});

test("비활성 Mermaid·표·수식 블록은 렌더링 위젯으로 교체한다", () => {
  const doc = "앞 문장\n\n```mermaid\nflowchart LR\n  A[시작] --> B[완료]\n```\n\n| 열 1 | 열 2 |\n| --- | --- |\n| 값 1 | 값 2 |\n\n$$\nx^2 + y^2\n$$";
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf("\n") + 1 } });
  const blockKinds: string[] = [];
  const decorations = buildLivePreviewDecorations(state);
  decorations.between(0, doc.length, (_from, _to, decoration) => {
    if (decoration.spec.block && decoration.spec.widget) blockKinds.push(decoration.spec.widget.constructor.name);
  });

  expect(blockKinds).toHaveLength(3);
});

test("표 구조 조작을 위한 Markdown 파서는 열·행과 정렬 정보를 보존한다", () => {
  const model = parseLiveTable("| 이름 | 설명 |\n| :--- | ---: |\n| A\\|1 | 첫 행 |");
  expect(model).toEqual({
    headers: ["이름", "설명"],
    alignments: [":---", "---:"],
    rows: [["A|1", "첫 행"]],
  });
  expect(serializeLiveTable(model!)).toBe("| 이름 | 설명 |\n| :--- | ---: |\n| A\\|1 | 첫 행 |");
});

test("라이브 프리뷰 표는 셀 내용에 맞춰 컴팩트하게 렌더링하고 추가 버튼을 표에 붙인다", () => {
  expect(editorSource).toContain('".cm-live-table-shell": { display: "inline-block"');
  expect(editorSource).toContain('maxWidth: "100%"');
  expect(editorSource).toContain('width: "fit-content"');
  expect(editorSource).toContain('".markdown-body .cm-live-table": {');
  expect(editorSource).toContain('width: "max-content"');
  expect(editorSource).toContain('".cm-live-preview-block-content .mermaid-diagram": { marginBottom: "0", marginTop: "0" }');
  expect(editorSource).toContain('".cm-live-preview-block-content .katex-display": { marginBottom: "0", marginTop: "0" }');
  expect(editorSource).toContain('".cm-live-preview-block-content.cm-live-table-shell": { marginBottom: "0", marginTop: "0" }');
  expect(editorSource).toContain('".cm-live-table-add-row":');
  expect(editorSource).toContain('width: "100%"');
  expect(editorSource).toContain('".cm-live-table-add-column":');
  expect(editorSource).toContain('position: "absolute"');
  expect(editorSource).toContain('overflow: "visible"');
  expect(editorSource).toContain('right: "-1.5rem"');
  expect(editorSource).toContain('top: "-1.5rem"');
  expect(editorSource).toContain('width: "0"');
  expect(tableSource).toContain('className="cm-live-table-column-handle"');
  expect(tableSource).toContain('cm-live-table-row-handle-active');
  expect(tableSource).toContain('title="뒤에 열 추가하기"');
  expect(tableSource).toContain('title="뒤에 행 추가하기"');
  expect(tableSource).toContain('type DropPosition = "before" | "after"');
  expect(tableSource).toContain('dropPosition(event, "x")');
  expect(tableSource).toContain('dropPosition(event, "y")');
  expect(tableSource).toContain('insertionIndex(index, position');
  expect(editorSource).toContain('".cm-live-table-column-drop-before":');
  expect(editorSource).toContain('".cm-live-table-column-drop-after":');
  expect(editorSource).toContain('".cm-live-table-row-drop-before > td:not(.cm-live-table-control-column)":');
  expect(editorSource).toContain('".cm-live-table-row-drop-after > td:not(.cm-live-table-control-column)":');
});

test("표는 Markdown 한 줄 대신 셀 입력과 키보드 이동을 제공한다", () => {
  expect(tableSource).toContain('data-live-table-cell="true"');
  expect(tableSource).toContain('event.key !== "Tab" && event.key !== "Enter"');
  expect(tableSource).toContain("event.shiftKey ? -1 : 1");
  expect(tableSource).toContain("draftRef.current.headers.map(() => \"\")");
  expect(livePreviewSource).toContain('event.target.closest("[data-live-table-control], [data-live-table-cell], [data-live-preview-control]")');
  expect(livePreviewSource).toContain('if (this.kind === "table")');
});

test("표 행과 열은 키보드로도 순서를 바꿀 수 있다", () => {
  expect(tableSource).toContain("handleColumnKeyDown");
  expect(tableSource).toContain("handleRowKeyDown");
  expect(tableSource).toContain('aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"');
  expect(tableSource).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
});

test("표 셀 우클릭 메뉴에서 행과 열을 삭제할 수 있다", () => {
  expect(tableSource).toContain('role="menu"');
  expect(tableSource).toContain('aria-label="표 편집 메뉴"');
  expect(tableSource).toContain("openContextMenuFromPointer");
  expect(tableSource).toContain("openContextMenuFromKeyboard");
  expect(tableSource).toContain('event.key !== "ContextMenu"');
  expect(tableSource).toContain('event.shiftKey && event.key === "F10"');
  expect(tableSource).toContain("deleteRow(contextMenu.rowIndex!)");
  expect(tableSource).toContain("deleteColumn(contextMenu.columnIndex!)");
  expect(tableSource).toContain("current.headers.length <= 2");
  expect(tableSource).toContain("행 삭제");
  expect(tableSource).toContain("열 삭제");
});

test("같은 줄의 커서 이동은 라이브 프리뷰 전체를 다시 계산하지 않는다", () => {
  expect(livePreviewSource).toContain("selectionLineKey(transaction.startState) !== selectionLineKey(transaction.state)");
  expect(livePreviewSource).toContain("replacementSpans");
});

test("표 블록은 커서가 들어가도 Markdown 원문으로 전환되지 않는다", () => {
  const doc = "| 이름 | 설명 |\n| --- | --- |\n| 값 | 내용 |";
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf("설명") } });
  const blockKinds: string[] = [];
  const decorations = buildLivePreviewDecorations(state);
  decorations.between(0, doc.length, (_from, _to, decoration) => {
    if (decoration.spec.block && decoration.spec.widget) blockKinds.push(decoration.spec.widget.constructor.name);
  });

  expect(blockKinds).toEqual(["LivePreviewBlockWidget"]);
});
