import { normalizeSurface } from "./normalize.js";

export type SurfaceKind =
  | "canonical"
  | "abbreviation"
  | "full_name"
  | "alias"
  | "discouraged"
  | "forbidden";

export type ValidationRule = "forbidden" | "non_standard" | "ambiguous" | "unregistered";
export type ValidationSeverity = "error" | "warning" | "info";

export interface LexiconEntry {
  termId: string;
  slug: string;
  text: string;
  kind: SurfaceKind;
  /** The preferred spelling to suggest for discouraged/forbidden surfaces. */
  replacement?: { text: string; slug?: string } | null;
}

export interface ValidationCandidate {
  termId: string;
  slug: string;
  text: string;
  kind: SurfaceKind;
}

export interface ValidationFinding {
  rule: ValidationRule;
  severity: ValidationSeverity;
  message: string;
  text: string;
  start: number;
  end: number;
  termId?: string;
  slug?: string;
  surfaceKind?: SurfaceKind;
  replacement?: { text: string; slug?: string } | null;
  candidates?: ValidationCandidate[];
}

export interface ValidationHighlight {
  kind: "registered" | "unregistered";
  text: string;
  start: number;
  end: number;
  termId?: string;
  slug?: string;
  surfaceKind?: SurfaceKind;
}

export interface ValidationStats {
  matched: number;
  errors: number;
  warnings: number;
  unregistered: number;
}

export interface ValidationResult {
  findings: ValidationFinding[];
  highlights?: ValidationHighlight[];
  highlightsTruncated?: boolean;
  stats: ValidationStats;
  lexiconVersion?: string;
}

export interface ValidateOptions {
  /** Markdown skips code, links, image destinations, URLs, and front matter. */
  format?: "markdown" | "plain";
  extractUnregistered?: boolean;
  ignoredCandidates?: readonly string[];
  maxFindings?: number;
  /** Include source spans for registered and unregistered surfaces. */
  includeHighlights?: boolean;
  lexiconVersion?: string;
}

interface CompiledEntry extends LexiconEntry {
  normLoose: string;
  pattern: readonly string[];
}

interface TrieNode {
  next: Map<string, number>;
  fail: number;
  outputs: number[];
}

interface ProjectedChar {
  char: string;
  start: number;
  end: number;
}

interface SourceRange {
  start: number;
  end: number;
}

interface RawMatch {
  entryIndexes: number[];
  start: number;
  end: number;
  patternLength: number;
}

export interface CompiledLexicon {
  readonly entries: readonly LexiconEntry[];
  readonly version?: string;
  /** @internal */
  readonly nodes: readonly TrieNode[];
  /** @internal */
  readonly compiledEntries: readonly CompiledEntry[];
  /** @internal */
  readonly knownNorms: ReadonlySet<string>;
}

const SURFACE_PRIORITY: Record<SurfaceKind, number> = {
  forbidden: 0,
  discouraged: 1,
  canonical: 2,
  abbreviation: 3,
  full_name: 4,
  alias: 5,
};

const KOREAN_PARTICLES = [
  "으로", "에서", "부터", "까지", "에게", "처럼", "보다", "마다", "조차", "만큼",
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만",
];

const WORD_CHAR = /^[\p{Letter}\p{Number}]$/u;
function isWordChar(value: string | undefined): boolean {
  return Boolean(value && WORD_CHAR.test(value));
}

function previousCodePoint(text: string, offset: number): string | undefined {
  if (offset <= 0) return undefined;
  const point = text.codePointAt(offset - 1);
  if (point === undefined) return undefined;
  return String.fromCodePoint(point);
}

function nextCodePoint(text: string, offset: number): string | undefined {
  const point = text.codePointAt(offset);
  return point === undefined ? undefined : String.fromCodePoint(point);
}

function hasAllowedKoreanParticle(text: string, offset: number): boolean {
  return KOREAN_PARTICLES.some((particle) => text.startsWith(particle, offset));
}

function passesBoundary(text: string, start: number, end: number): boolean {
  const previous = previousCodePoint(text, start);
  if (isWordChar(previous)) return false;

  const next = nextCodePoint(text, end);
  if (!isWordChar(next)) return true;

  // Korean particles are intentionally accepted after a matched term. This lets
  // "이미지센서의" and "AE는" validate without accepting a longer unknown word.
  return hasAllowedKoreanParticle(text, end);
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  const sorted = [...ranges].filter((range) => range.end > range.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function markdownExcludedRanges(document: string): SourceRange[] {
  const ranges: SourceRange[] = [];

  // YAML/TOML-style front matter is metadata, not prose to validate.
  if (/^---(?:\r?\n|$)/.test(document)) {
    const closing = document.indexOf("\n---", 4);
    if (closing >= 0) {
      const endLine = document.indexOf("\n", closing + 1);
      ranges.push({ start: 0, end: endLine >= 0 ? endLine + 1 : document.length });
    }
  }

  // Exclude fenced code blocks line by line so a term cannot match across the
  // skipped block and a surrounding sentence.
  const linePattern = /.*(?:\r?\n|$)/g;
  let offset = 0;
  let fence: { start: number; marker: string } | null = null;
  for (const line of document.match(linePattern) ?? []) {
    if (line.length === 0) break;
    const marker = line.match(/^[ \t]*(`{3,}|~{3,})/u)?.[1];
    if (marker && !fence) {
      fence = { start: offset, marker: marker.startsWith("`") ? "`" : "~" };
    } else if (marker && fence && (marker.startsWith("`") ? "`" : "~") === fence.marker) {
      ranges.push({ start: fence.start, end: offset + line.length });
      fence = null;
    }
    offset += line.length;
  }
  if (fence) ranges.push({ start: fence.start, end: document.length });

  // Inline code, URLs, and image destinations are not natural-language prose.
  for (const pattern of [
    /`[^`\r\n]*`/gu,
    /https?:\/\/[^\s<>()]+/giu,
    /!\[[^\]]*\]\([^\r\n)]*\)/gu,
  ]) {
    for (const match of document.matchAll(pattern)) {
      if (match.index !== undefined) ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return mergeRanges(ranges);
}

function inRange(ranges: readonly SourceRange[], offset: number): boolean {
  // The range count is small for a document. Keeping this linear avoids a
  // second interval-tree implementation in the pure engine package.
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

function projectDocument(document: string, excluded: readonly SourceRange[]): Array<ProjectedChar | null> {
  const projected: Array<ProjectedChar | null> = [];
  let offset = 0;
  let blocked = false;

  for (const original of Array.from(document)) {
    const end = offset + original.length;
    if (inRange(excluded, offset)) {
      blocked = true;
      offset = end;
      continue;
    }
    if (blocked) projected.push(null);
    blocked = false;

    const normalized = original.normalize("NFKC").toLowerCase();
    for (const point of Array.from(normalized)) {
      // Match the same separator policy as normalizeSurface, while retaining
      // the source span of every emitted character.
      if (/^[\s\-_/.·・]$/u.test(point)) continue;
      projected.push({ char: point, start: offset, end });
    }
    offset = end;
  }
  return projected;
}

function buildTrie(entries: readonly CompiledEntry[]): TrieNode[] {
  const nodes: TrieNode[] = [{ next: new Map(), fail: 0, outputs: [] }];

  entries.forEach((entry, entryIndex) => {
    let nodeIndex = 0;
    for (const char of entry.pattern) {
      const next = nodes[nodeIndex]!.next.get(char);
      if (next !== undefined) {
        nodeIndex = next;
      } else {
        const created = nodes.length;
        nodes.push({ next: new Map(), fail: 0, outputs: [] });
        nodes[nodeIndex]!.next.set(char, created);
        nodeIndex = created;
      }
    }
    nodes[nodeIndex]!.outputs.push(entryIndex);
  });

  const queue: number[] = [];
  for (const child of nodes[0]!.next.values()) queue.push(child);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [char, child] of nodes[current]!.next) {
      queue.push(child);
      let fallback = nodes[current]!.fail;
      while (fallback !== 0 && !nodes[fallback]!.next.has(char)) fallback = nodes[fallback]!.fail;
      const fallbackChild = nodes[fallback]!.next.get(char);
      nodes[child]!.fail = fallbackChild !== undefined && fallbackChild !== child ? fallbackChild : 0;
      nodes[child]!.outputs.push(...nodes[nodes[child]!.fail]!.outputs);
    }
  }

  return nodes;
}

export function compileLexicon(entries: readonly LexiconEntry[], version?: string): CompiledLexicon {
  const compiledEntries: CompiledEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeSurface(entry.text).loose;
    if (!normalized) continue;
    const key = `${entry.termId}\u0000${entry.kind}\u0000${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    compiledEntries.push({ ...entry, normLoose: normalized, pattern: Array.from(normalized) });
  }

  return {
    entries: compiledEntries,
    version,
    nodes: buildTrie(compiledEntries),
    compiledEntries,
    knownNorms: new Set(compiledEntries.map((entry) => entry.normLoose)),
  };
}

function rawMatches(document: string, lexicon: CompiledLexicon, excluded: readonly SourceRange[]): RawMatch[] {
  const projected = projectDocument(document, excluded);
  const matches: RawMatch[] = [];
  let state = 0;

  for (let index = 0; index < projected.length; index += 1) {
    const item = projected[index];
    if (!item) {
      state = 0;
      continue;
    }
    while (state !== 0 && !lexicon.nodes[state]!.next.has(item.char)) state = lexicon.nodes[state]!.fail;
    state = lexicon.nodes[state]!.next.get(item.char) ?? 0;
    for (const entryIndex of lexicon.nodes[state]!.outputs) {
      const entry = lexicon.compiledEntries[entryIndex]!;
      const startIndex = index - entry.pattern.length + 1;
      const startItem = projected[startIndex];
      if (!startItem || startIndex < 0) continue;
      const start = startItem.start;
      const end = item.end;
      if (passesBoundary(document, start, end)) {
        matches.push({ entryIndexes: [entryIndex], start, end, patternLength: entry.pattern.length });
      }
    }
  }

  const grouped = new Map<string, RawMatch>();
  for (const match of matches) {
    const key = `${match.start}:${match.end}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, match);
    else current.entryIndexes.push(...match.entryIndexes);
  }

  return [...grouped.values()]
    .map((match) => ({ ...match, entryIndexes: [...new Set(match.entryIndexes)] }))
    .sort((a, b) => a.start - b.start || b.patternLength - a.patternLength || b.end - a.end);
}

function chooseMatches(matches: readonly RawMatch[]): RawMatch[] {
  const chosen: RawMatch[] = [];
  for (const match of matches) {
    const overlaps = chosen.some((current) => match.start < current.end && current.start < match.end);
    if (!overlaps) chosen.push(match);
  }
  return chosen;
}

function bestEntry(entries: readonly CompiledEntry[], indexes: readonly number[]): CompiledEntry {
  return indexes.map((index) => entries[index]!).sort((a, b) => SURFACE_PRIORITY[a.kind] - SURFACE_PRIORITY[b.kind])[0]!;
}

function candidatesFor(entries: readonly CompiledEntry[], indexes: readonly number[]): ValidationCandidate[] {
  return indexes.map((index) => {
    const entry = entries[index]!;
    return { termId: entry.termId, slug: entry.slug, text: entry.text, kind: entry.kind };
  });
}

function replacementFor(entries: readonly CompiledEntry[], selected: CompiledEntry) {
  if (selected.replacement) return selected.replacement;
  const canonical = entries.find((entry) => entry.termId === selected.termId && entry.kind === "canonical");
  return canonical ? { text: canonical.text, slug: canonical.slug } : null;
}

const ENGLISH_FUNCTION_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "the", "this", "that", "to", "was", "were", "with",
]);

function hasKoreanSentenceContext(document: string, start: number, end: number): boolean {
  const before = document.slice(Math.max(0, start - 120), start).split(/[.!?\r\n]/).at(-1) ?? "";
  const after = document.slice(end, Math.min(document.length, end + 120)).split(/[.!?\r\n]/)[0] ?? "";
  return /[가-힣]/.test(before + after);
}

function isEnglishCandidate(document: string, text: string, start: number, end: number): boolean {
  if (text.length < 2 || (text === text.toLowerCase() && ENGLISH_FUNCTION_WORDS.has(text))) return false;
  if (/^[A-Za-z]\d+$/.test(text)) return false;
  const previous = previousCodePoint(document, start);
  const next = nextCodePoint(document, end);
  if ((previous && /[A-Za-z0-9_]/.test(previous)) || (next && /[A-Za-z0-9_]/.test(next))) return false;
  // Technical spelling carries evidence even in an English-only document.
  if (/^[A-Z][A-Z0-9]{1,11}$/.test(text) || /[._/-]/.test(text)
    || /[a-z][A-Z]/.test(text) || /[A-Za-z]\d/.test(text)) return true;
  // A plain single English word is useful in Korean prose, but English prose
  // must not turn into a glossary candidate for every word.
  return hasKoreanSentenceContext(document, start, end);
}

function addUnregisteredFindings(
  document: string,
  lexicon: CompiledLexicon,
  excluded: readonly SourceRange[],
  matched: readonly RawMatch[],
  findings: ValidationFinding[],
  ignoredCandidates: readonly string[],
  collectHighlights: boolean,
): ValidationHighlight[] {
  const ignored = new Set(ignoredCandidates.map((candidate) => normalizeSurface(candidate).loose).filter(Boolean));
  const patterns = [
    { expression: /(?<![A-Za-z0-9_])([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+)(?![A-Za-z0-9_])/g, english: false },
    { expression: /(?<![A-Za-z0-9_])([A-Za-z](?:\+\+|#)|\.NET)(?![A-Za-z0-9_])/g, english: false },
    { expression: /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9]*(?:[._/-][A-Za-z0-9]+)*)(?![A-Za-z0-9_])/g, english: true },
    // A Korean word is only a candidate when the author explicitly defines it.
    // Absence from the glossary is not evidence that every noun needs registration.
    { expression: /([가-힣]{2,20}?)(?:이란|란)(?=\s|[,:：])/g, english: false },
    { expression: /[“"‘']([가-힣]{2,20}(?:\s+[가-힣]{2,20}){0,3})[”"’']\s*(?:이란|란)(?=\s|[,:：])/g, english: false },
  ];
  const seen = new Set<string>();
  const highlights: ValidationHighlight[] = [];
  const matchedRanges = matched.map((item) => ({ start: item.start, end: item.end }));

  const occurrences: Array<{ text: string; start: number; end: number }> = [];
  for (const { expression, english } of patterns) {
    for (const result of document.matchAll(expression)) {
      const text = result[1]!;
      const start = (result.index ?? -1) + result[0].indexOf(text);
      const end = start + text.length;
      if (start < 0 || (english && !isEnglishCandidate(document, text, start, end))) continue;
      occurrences.push({ text, start, end });
    }
  }
  occurrences.sort((a, b) => a.start - b.start || b.end - a.end);

  let lastCandidateEnd = -1;
  for (const { text, start, end } of occurrences) {
    if (start < lastCandidateEnd || excluded.some((range) => start < range.end && range.start < end)
      || matchedRanges.some((range) => start < range.end && range.start < end)) continue;
    const normalized = normalizeSurface(text).loose;
    if (!normalized || ignored.has(normalized) || lexicon.knownNorms.has(normalized)) continue;
    lastCandidateEnd = end;
    if (collectHighlights) highlights.push({ kind: "unregistered", text, start, end });
    if (!seen.has(normalized)) {
      seen.add(normalized);
      findings.push({
        rule: "unregistered",
        severity: "info",
        message: "문서에 등장하지만 사전에 등록되지 않은 용어 후보입니다.",
        text,
        start,
        end,
      });
    }
  }
  return highlights;
}

export function validateDocument(
  document: string,
  lexicon: CompiledLexicon | readonly LexiconEntry[],
  options: ValidateOptions = {},
): ValidationResult {
  const compiled: CompiledLexicon = Array.isArray(lexicon)
    ? compileLexicon(lexicon, options.lexiconVersion)
    : lexicon as CompiledLexicon;
  const excluded = options.format === "plain" ? [] : markdownExcludedRanges(document);
  const matches = chooseMatches(rawMatches(document, compiled, excluded));
  const findings: ValidationFinding[] = [];
  const collectHighlights = options.includeHighlights === true;
  const highlights: ValidationHighlight[] = collectHighlights ? matches.map((match) => {
    const selected = bestEntry(compiled.compiledEntries, match.entryIndexes);
    return {
      kind: "registered",
      text: document.slice(match.start, match.end),
      start: match.start,
      end: match.end,
      termId: selected.termId,
      slug: selected.slug,
      surfaceKind: selected.kind,
    };
  }) : [];

  for (const match of matches) {
    const entries = match.entryIndexes.map((index) => compiled.compiledEntries[index]!);
    const selected = bestEntry(compiled.compiledEntries, match.entryIndexes);
    const distinctTerms = new Set(entries.map((entry) => entry.termId));
    const text = document.slice(match.start, match.end);
    const candidates = distinctTerms.size > 1 ? candidatesFor(compiled.compiledEntries, match.entryIndexes) : undefined;

    let finding: ValidationFinding | null = null;
    if (selected.kind === "forbidden") {
      finding = {
        rule: "forbidden",
        severity: "error",
        message: "금지된 표기입니다.",
        text,
        start: match.start,
        end: match.end,
        termId: selected.termId,
        slug: selected.slug,
        surfaceKind: selected.kind,
        replacement: replacementFor(compiled.compiledEntries, selected),
        candidates,
      };
    } else if (selected.kind === "discouraged") {
      finding = {
        rule: "non_standard",
        severity: "warning",
        message: "비권장 표기입니다.",
        text,
        start: match.start,
        end: match.end,
        termId: selected.termId,
        slug: selected.slug,
        surfaceKind: selected.kind,
        replacement: replacementFor(compiled.compiledEntries, selected),
        candidates,
      };
    } else if (distinctTerms.size > 1) {
      finding = {
        rule: "ambiguous",
        severity: "warning",
        message: "여러 용어에서 사용하는 표기입니다. 도메인을 확인해 주세요.",
        text,
        start: match.start,
        end: match.end,
        surfaceKind: selected.kind,
        candidates,
      };
    }
    if (finding) findings.push(finding);
  }

  if (options.extractUnregistered !== false) {
    highlights.push(...addUnregisteredFindings(document, compiled, excluded, matches, findings, options.ignoredCandidates ?? [], collectHighlights));
  }

  const maxFindings = Math.max(1, Math.floor(options.maxFindings ?? 5_000));
  const limited = findings.slice(0, maxFindings);
  if (collectHighlights) highlights.sort((a, b) => a.start - b.start || a.end - b.end);
  const stats: ValidationStats = {
    matched: matches.length,
    errors: limited.filter((finding) => finding.severity === "error").length,
    warnings: limited.filter((finding) => finding.severity === "warning").length,
    unregistered: limited.filter((finding) => finding.rule === "unregistered").length,
  };

  return {
    findings: limited,
    ...(collectHighlights ? {
      highlights: highlights.slice(0, maxFindings),
      highlightsTruncated: highlights.length > maxFindings,
    } : {}),
    stats,
    ...(compiled.version || options.lexiconVersion ? { lexiconVersion: compiled.version ?? options.lexiconVersion } : {}),
  };
}
