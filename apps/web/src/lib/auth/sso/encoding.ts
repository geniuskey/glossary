const WINDOWS_1252_BYTES = new Map<string, number>([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a],
  ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92],
  ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c],
  ["ž", 0x9e], ["Ÿ", 0x9f],
]);

const decoder = new TextDecoder("utf-8", { fatal: true });
const SUSPICIOUS = /[ÃÂâðìíëêï]|[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|[\u0080-\u009f]/g;

function suspiciousScore(value: string): number {
  return value.match(SUSPICIOUS)?.length ?? 0;
}

function windows1252Bytes(value: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const character of value) {
    const mapped = WINDOWS_1252_BYTES.get(character);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) return null;
    bytes.push(codePoint);
  }
  return Uint8Array.from(bytes);
}

/** UTF-8 바이트를 latin-1/Windows-1252 문자로 잘못 읽은 이름을 보수적으로 복원한다. */
export function repairMojibake(input: string): string {
  const value = input.trim();
  if (!value || suspiciousScore(value) === 0) return value;
  const bytes = windows1252Bytes(value);
  if (!bytes) return value;
  try {
    const repaired = decoder.decode(bytes).trim();
    if (!repaired || repaired.includes("\uFFFD")) return value;
    const restoredHangul = /[가-힣]/.test(repaired) && !/[가-힣]/.test(value);
    return restoredHangul || suspiciousScore(repaired) < suspiciousScore(value) ? repaired : value;
  } catch {
    return value;
  }
}

export function looksLikeMojibake(value: string): boolean {
  return repairMojibake(value) !== value.trim();
}
