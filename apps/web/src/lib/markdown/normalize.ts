/**
 * remark-math는 블록 구분자와 수식 내용이 같은 줄에서 시작하거나 끝나면
 * display math로 해석하지 않는다. 사용자가 자주 붙여 넣는 `$$수식 ... 수식$$`
 * 형태를 표준적인 독립 구분자 형태로 바꾸되 fenced code는 그대로 둔다.
 */
export function normalizeDisplayMath(markdown: string): string {
  const output: string[] = [];
  let fence: { character: string; length: number } | null = null;
  let mathIndent = "";
  let inCompactDisplayMath = false;

  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!inCompactDisplayMath && fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fence) {
        fence = { character: marker[0]!, length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      output.push(line);
      continue;
    }

    if (fence) {
      output.push(line);
      continue;
    }

    if (!inCompactDisplayMath) {
      const opening = line.match(/^(\s{0,3})\$\$(?!\$)(.+)$/);
      if (opening && !opening[2]!.includes("$$")) {
        mathIndent = opening[1]!;
        inCompactDisplayMath = true;
        output.push(`${mathIndent}$$`, `${mathIndent}${opening[2]!}`);
        continue;
      }
    } else {
      if (/^\s{0,3}\$\$\s*$/.test(line)) {
        inCompactDisplayMath = false;
        output.push(line);
        continue;
      }

      const closing = line.match(/^(.*\S)\$\$\s*$/);
      if (closing) {
        inCompactDisplayMath = false;
        output.push(closing[1]!, `${mathIndent}$$`);
        continue;
      }
    }

    output.push(line);
  }

  return output.join("\n");
}
