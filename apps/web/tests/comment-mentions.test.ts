import { expect, test } from "vitest";
import {
  activeMentionQuery, decodeMentions, encodeMentions, filterMentionUsers, insertMention, mentionedUserIds, parseCommentBody,
} from "../src/lib/comments/mentions.js";
import { buildCommentTree, countVisibleComments, type TermCommentWire } from "../src/lib/comments/tree.js";

const kim = { id: "11111111-1111-4111-8111-111111111111", name: "김민" };
const kimsu = { id: "22222222-2222-4222-8222-222222222222", name: "김민수" };

test("입력창의 @이름을 고른 사용자 토큰으로 바꾸고 다시 되돌린다", () => {
  const body = encodeMentions("@김민수 님, @김민 님 확인 부탁", [kim, kimsu]);
  // 짧은 이름이 긴 이름의 앞부분을 먹으면 "@[김민](…)수"가 된다.
  expect(body).toBe(`@[김민수](user:${kimsu.id}) 님, @[김민](user:${kim.id}) 님 확인 부탁`);
  expect(mentionedUserIds(body)).toEqual([kimsu.id, kim.id]);
  expect(decodeMentions(body)).toEqual({ text: "@김민수 님, @김민 님 확인 부탁", mentions: [kimsu, kim] });
  // 이미 토큰인 본문을 다시 encode해도 이중으로 감싸지 않는다(수정 흐름).
  expect(encodeMentions(body, [kim, kimsu])).toBe(body);
});

test("고르지 않은 @이름과 지운 멘션은 평문으로 남는다", () => {
  expect(encodeMentions("@아무개 안녕", [kim])).toBe("@아무개 안녕");
  expect(mentionedUserIds("@[가짜](user:not-a-uuid)")).toEqual([]);
  expect(parseCommentBody("앞 @[김민](user:11111111-1111-4111-8111-111111111111) 뒤")).toEqual([
    { kind: "text", text: "앞 " },
    { kind: "mention", userId: kim.id, name: "김민" },
    { kind: "text", text: " 뒤" },
  ]);
});

test("@ 자동완성은 공백 뒤에서만 열린다", () => {
  expect(activeMentionQuery("안녕 @김", 5)).toEqual({ start: 3, query: "김" });
  expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  expect(activeMentionQuery("kim@example", 11)).toBeNull();
  expect(activeMentionQuery("@김 민", 4)).toBeNull();
  expect(insertMention("안녕 @김 뒤", 5, kimsu)).toEqual({ text: "안녕 @김민수 뒤", caret: 8 });
});

test("이름이 검색어로 시작하는 사람이 먼저 나온다", () => {
  const users = [{ id: "a", name: "박김수", email: "p@x" }, { id: "b", name: "김철수", email: "k@x" }];
  expect(filterMentionUsers(users, "김").map((u) => u.id)).toEqual(["b", "a"]);
  expect(filterMentionUsers(users, "p@").map((u) => u.id)).toEqual(["a"]);
});

function comment(id: string, parentId: string | null, at: number, deleted = false): TermCommentWire {
  const iso = new Date(Date.UTC(2026, 0, 1, 0, at)).toISOString();
  return { id, parentId, authorId: null, authorName: null, body: deleted ? "" : id, mentionedUserIds: [], createdAt: iso, updatedAt: iso, edited: false, deleted };
}

test("삭제된 댓글은 살아 있는 답글이 있을 때만 자리를 남긴다", () => {
  const tree = buildCommentTree([
    comment("c", "a", 3), comment("a", null, 1, true), comment("b", null, 2, true), comment("d", "c", 4),
  ]);
  expect(tree.map((n) => n.id)).toEqual(["a"]);
  expect(tree[0]!.replies[0]!.id).toBe("c");
  expect(tree[0]!.replies[0]!.replies[0]!.id).toBe("d");
  expect(countVisibleComments(tree)).toBe(2);
});
