import "server-only";

function balancedJsonCandidates(text: string): string[] {
  let start = -1;
  const stack: string[] = [];
  const candidates: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (stack.length === 0 && (char === "{" || char === "[")) {
      start = index;
      stack.push(char);
      continue;
    }
    if (stack.length === 0) continue;
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack[stack.length - 1] !== expected) {
        // A malformed outer object must not make a valid-looking nested array
        // parse as if it were the model's complete response.
        stack.length = 0;
        start = -1;
        quoted = false;
        escaped = false;
        continue;
      }
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

/** Parses common model wrappers without accepting arbitrary prose as data. */
export function parseAiJson(raw: string): unknown {
  const normalized = raw.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/```(?:json)?/gi, " ").trim();
  try {
    return JSON.parse(normalized);
  } catch {
    for (const candidate of balancedJsonCandidates(normalized)) {
      try {
        return JSON.parse(candidate);
      } catch {
        // 설명 속 예시 JSON일 수 있다. 안전을 위해 임의의 중첩 조각은 사용하지 않는다.
      }
    }
    return null;
  }
}
