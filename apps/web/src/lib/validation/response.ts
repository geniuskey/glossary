import type { ValidationFinding, ValidationResult, ValidationSeverity } from "@glossary/engine";

const SEVERITY_RANK: Record<ValidationSeverity, number> = { error: 3, warning: 2, info: 1 };

function lineColumn(content: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastBreak = -1;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lastBreak = index;
    }
  }
  return { line, col: offset - lastBreak };
}

export function wireFinding(content: string, finding: ValidationFinding) {
  const start = lineColumn(content, finding.start);
  const end = lineColumn(content, finding.end);
  return {
    rule: finding.rule,
    severity: finding.severity,
    span: { start: finding.start, end: finding.end, line: start.line, col: start.col, endLine: end.line, endCol: end.col },
    matchedText: finding.text,
    ...(finding.termId ? { termId: finding.termId } : {}),
    ...(finding.slug ? { slug: finding.slug } : {}),
    ...(finding.surfaceKind ? { surfaceKind: finding.surfaceKind } : {}),
    message: finding.message,
    ...(finding.replacement ? { suggestions: [{ ...finding.replacement, reason: "canonical" }] } : {}),
    ...(finding.candidates ? { candidates: finding.candidates } : {}),
  };
}

export function filterResult(result: ValidationResult, minSeverity: ValidationSeverity): ValidationResult {
  const findings = result.findings.filter((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[minSeverity]);
  return {
    ...result,
    findings,
    stats: {
      matched: result.stats.matched,
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      unregistered: findings.filter((finding) => finding.rule === "unregistered").length,
    },
  };
}
