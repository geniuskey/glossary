import { expect, test } from "vitest";
import { parseAiJson } from "../src/lib/ai/json.js";

test("모델의 think·코드블록·설명 포장을 제거하고 JSON을 복원한다", () => {
  expect(parseAiJson('설명입니다. <think>중간 사고 {"bad":true}</think> ```json\n{"ok":true,"text":"} 안의 문자"}\n```')).toEqual({ ok: true, text: "} 안의 문자" });
});

test("균형이 맞지 않는 응답은 null로 남겨 안전한 상위 폴백을 선택하게 한다", () => {
  expect(parseAiJson('{"items":[1,2]')).toBeNull();
});
