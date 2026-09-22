import { expect, test } from "vitest";
import { extractMarkdownImages } from "@/lib/markdown/images";

test("Markdown 근거에서 내부 첨부 이미지만 중복 없이 추출한다", () => {
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  expect(extractMarkdownImages([
    `![도표\\]](/api/v1/attachments/${hash}?width=640&height=480)`,
    `![같은 이미지](/api/v1/attachments/${hash}?width=640&height=480)`,
    `![외부 이미지](https://example.com/image.png)`,
    `![두 번째](/api/v1/attachments/${otherHash})`,
  ].join("\n"))).toEqual([
    { url: `/api/v1/attachments/${hash}?width=640&height=480`, alt: "도표]" },
    { url: `/api/v1/attachments/${otherHash}`, alt: "두 번째" },
  ]);
});

test("빈 Markdown이나 잘못된 첨부 URL은 이미지 근거를 만들지 않는다", () => {
  expect(extractMarkdownImages(null)).toEqual([]);
  expect(extractMarkdownImages("![x](/api/v1/attachments/not-a-hash)")).toEqual([]);
});
