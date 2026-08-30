import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { DailyGrowthChart } from "../src/components/statistics-charts.js";

test("SVG title은 hydration 시 합쳐질 여러 텍스트 노드를 만들지 않는다", () => {
  const html = renderToStaticMarkup(DailyGrowthChart({
    data: [{
      date: "2026-08-02",
      termsCreated: 2,
      usersCreated: 1,
      revisions: 3,
      cumulativeTerms: 10,
      cumulativeUsers: 4,
    }],
  }));

  expect(html).toContain("<title>2026-08-02 신규 용어 2개</title>");
  expect(html).toContain("<title>2026-08-02 신규 사용자 1명</title>");
  expect(html).not.toMatch(/<title>[^<]*<!-- -->/);
});
