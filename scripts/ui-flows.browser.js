// Playwright MCP browser_run_code_unsafe의 filename으로 실행한다.
// localhost:3000에 로그인한 컨텍스트를 사용하며, 별도 탭에서 검사 후 닫는다.
// 모든 API 쓰기를 차단한다. 검색 후보와 챗봇 API는 테스트 응답만 사용한다.
async (page) => {
  const base = "http://localhost:3000";
  const review = await page.context().newPage();
  const passed = [];
  const skipped = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const sessions = ids.map((id, index) => ({ id, title: `검증 대화 ${index + 1}`, createdAt: "2026-09-09T12:00:00Z", updatedAt: "2026-09-09T12:00:00Z", messageCount: 2 }));
  let deleteRequests = 0;
  let deleteMode = "failure";
  let loadMode = "success";
  let releaseSlow;
  let finishSlow;
  let slowStarted;
  let replyMode = "slow";
  let releaseReply;
  let finishReply;
  let startReply;
  const replyDone = new Promise((resolve) => { finishReply = resolve; });
  const replyStarted = new Promise((resolve) => { startReply = resolve; });
  const slowDone = new Promise((resolve) => { finishSlow = resolve; });
  const started = new Promise((resolve) => { slowStarted = resolve; });
  try {
    await review.route("**/api/**", (route) => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
    await review.route("**/api/v1/terms/suggest*", (route) => route.fulfill({ json: { items: [{ id: "review-sla", slug: "sla", matchedText: "SLA", matchedKind: "canonical", nameEn: "SLA", nameKo: null, status: "active", prefix: true, exact: false }] } }));
    await review.goto(`${base}/new`);
    check(review.url() === `${base}/new`, "로컬 앱에 먼저 로그인해야 합니다.");
    await review.locator('[name="nameEn"]').fill("저장되지 않은 검증용 입력");
    await review.evaluate(() => {
      window.__reviewConfirmCount = 0;
      window.confirm = () => { window.__reviewConfirmCount++; return false; };
    });
    const search = review.getByRole("combobox", { name: "용어 검색", exact: true });
    await search.fill("s");
    await review.getByRole("listbox").waitFor();
    await search.press("ArrowDown");
    await search.press("Enter");
    check(review.url() === `${base}/new`, "키보드 자동완성이 이탈 경고를 우회했습니다.");
    check(await review.locator('[name="nameEn"]').inputValue() === "저장되지 않은 검증용 입력", "입력 내용이 사라졌습니다.");
    check(await review.evaluate(() => window.__reviewConfirmCount) === 1, "키보드 이탈 경고가 없습니다.");
    await review.getByRole("listbox").locator("a").click();
    check(await review.evaluate(() => window.__reviewConfirmCount) === 2, "클릭 이탈 경고가 없습니다.");
    check(review.url() === `${base}/new`, "경고 취소 후 화면을 벗어났습니다.");
    passed.push("자동완성 클릭·Enter의 이탈 경고와 입력 보존");

    const tabCount = (await review.context().pages()).length;
    await review.getByRole("listbox").locator("a").click({ modifiers: ["Control"] });
    let tabs = await review.context().pages();
    for (let attempt = 0; tabs.length === tabCount && attempt < 30; attempt++) {
      await review.waitForTimeout(100);
      tabs = await review.context().pages();
    }
    check(tabs.length === tabCount + 1, "Ctrl+클릭으로 새 탭이 열리지 않았습니다.");
    const popup = tabs.at(-1);
    await popup.close();
    check(await review.evaluate(() => window.__reviewConfirmCount) === 2, "새 탭에도 불필요한 이탈 경고가 뜹니다.");
    check(review.url() === `${base}/new`, "새 탭 열기가 원래 화면을 변경했습니다.");
    passed.push("Ctrl+클릭 새 탭 열기");
    await review.evaluate(() => { window.confirm = () => true; });
    await search.fill("sl");
    await review.getByRole("listbox").waitFor();
    await review.getByRole("listbox").locator("a").click();
    await review.waitForURL(`${base}/w/sla`);
    passed.push("이탈 승인 후 이동");

    let settingsSaveFails = true;
    await review.route("**/api/v1/account", (route) => settingsSaveFails
      ? route.fulfill({ status: 503, json: { error: { message: "프로필 저장 실패 검증" } } })
      : route.fulfill({ json: {} }));
    await review.goto(`${base}/settings`);
    await review.getByRole("textbox", { name: "표시 이름" }).fill("검증 수정 이름");
    await review.evaluate(() => {
      window.__reviewConfirmCount = 0;
      window.confirm = () => { window.__reviewConfirmCount++; return false; };
    });
    await review.locator('#primary-navigation a[href="/sheet"]').click();
    check(review.url() === `${base}/settings`, "프로필 변경사항이 보호되지 않았습니다.");
    await review.getByRole("button", { name: "변경", exact: true }).click();
    await review.getByText("프로필 저장 실패 검증", { exact: true }).waitFor();
    check(await review.getByRole("textbox", { name: "표시 이름" }).inputValue() === "검증 수정 이름", "저장 실패 후 표시 이름을 잃었습니다.");
    settingsSaveFails = false;
    await review.getByRole("button", { name: "변경", exact: true }).click();
    await review.getByText("이름을 변경했습니다.", { exact: true }).waitFor();
    await review.locator('#primary-navigation a[href="/sheet"]').click();
    await review.waitForURL(`${base}/sheet`);
    passed.push("프로필 이탈 경고·저장 실패 보존·저장 후 이동");

    await review.goto(`${base}/admin`);
    if (review.url() === `${base}/admin`) {
      await review.route("**/api/v1/admin/home-content", (route) => route.fulfill({ json: { settings: route.request().postDataJSON() } }));
      const title = review.locator("textarea").first();
      await title.fill("검증용 홈 대표 문구");
      await review.evaluate(() => {
        window.__reviewConfirmCount = 0;
        window.confirm = () => { window.__reviewConfirmCount++; return false; };
      });
      await review.getByRole("button", { name: "기본 문구 불러오기" }).click();
      check(await title.inputValue() === "검증용 홈 대표 문구", "기본값 교체 취소 후 내용을 잃었습니다.");
      await review.locator('a[href="/admin?tab=ai"]').click();
      check(review.url() === `${base}/admin`, "홈 문구 이탈 경고가 없습니다.");
      check(await review.evaluate(() => window.__reviewConfirmCount) === 2, "기본값 교체/이탈 확인 횟수가 다릅니다.");
      await review.getByRole("button", { name: "홈 문구 저장", exact: true }).click();
      await review.getByText("홈 소개 문구를 저장했습니다.", { exact: true }).waitFor();
      check(await review.getByRole("button", { name: "홈 문구 저장", exact: true }).isDisabled(), "저장 완료 후 변경 상태가 남아 있습니다.");
      await review.locator('a[href="/admin?tab=ai"]').click();
      await review.waitForURL(`${base}/admin?tab=ai`);
      passed.push("홈 문구 기본값 교체·이탈 취소·저장 상태 갱신");
    } else skipped.push("관리자 권한 없음: 홈 소개 편집");

    await review.route("**/api/v1/chat*", async (route) => {
      if (route.request().method() === "POST") {
        if (replyMode === "failure") return route.fulfill({ status: 503, json: { error: { message: "답변 실패 검증", details: { sessionId: "33333333-3333-4333-8333-333333333333" } } } });
        startReply();
        await new Promise((resolve) => { releaseReply = resolve; });
        await route.fulfill({ json: { sessionId: ids[1], answer: "늦은 답변 2" } });
        finishReply();
        return;
      }
      if (route.request().method() === "DELETE") {
        deleteRequests++;
        return deleteMode === "failure" ? route.abort("failed") : route.fulfill({ json: { deleted: true } });
      }
      if (route.request().method() !== "GET") return route.abort();
      const id = route.request().url().split("session=")[1]?.split("&")[0];
      if (loadMode === "failure") return route.fulfill({ status: 503, json: { error: { message: "검증용 일시 장애" } } });
      const slow = loadMode === "slow" && id === ids[0];
      if (slow) {
        slowStarted();
        await new Promise((resolve) => { releaseSlow = resolve; });
      }
      try {
        await route.fulfill({ json: { sessions, conversation: id ? { ...sessions.find((session) => session.id === id), messages: [{ id: 1, role: "user", content: `질문 ${id[0]}` }, { id: 2, role: "assistant", content: `보존할 답변 ${id[0]}` }] } : null } });
      } catch (error) {
        if (!slow) throw error;
      } finally {
        if (slow) finishSlow();
      }
    });
    await review.goto(`${base}/c/${ids[0]}`);
    await review.getByRole("button", { name: "대화 지우기", exact: true }).waitFor();
    await review.evaluate(() => { window.confirm = () => false; });
    await review.getByRole("button", { name: "대화 지우기", exact: true }).click();
    check(deleteRequests === 0, "삭제 확인 취소 후에도 DELETE 요청이 발생했습니다.");
    passed.push("대화 삭제 취소 시 요청 없음");
    await review.evaluate(() => { window.confirm = () => true; });
    await review.getByRole("button", { name: "대화 지우기", exact: true }).click();
    await review.getByRole("alert").filter({ hasText: "네트워크 오류로 대화를 지우지 못했습니다." }).waitFor();
    check(deleteRequests === 1, "삭제 실패 검증 요청 수가 다릅니다.");
    check(await review.getByRole("button", { name: "대화 지우기", exact: true }).isEnabled(), "삭제 실패 후 재시도할 수 없습니다.");
    // AI 비활성 설치에서도 상태 버튼과 URL로 대화 보존을 검증한다.
    check(review.url() === `${base}/c/${ids[0]}`, "삭제 실패 후 현재 대화에서 벗어났습니다.");
    passed.push("삭제 실패 안내와 재시도 가능 상태");
    await review.getByRole("button", { name: /검증 대화 2/ }).click();
    await review.waitForFunction((id) => document.querySelector(`[aria-label="챗봇 대화 기록"] [aria-current="page"]`)?.textContent?.includes("검증 대화 2") && location.pathname.endsWith(id), ids[1]);
    await review.goBack();
    await review.waitForFunction(() => document.querySelector('[aria-label="챗봇 대화 기록"] [aria-current="page"]')?.textContent?.includes("검증 대화 1"));
    await review.goForward();
    await review.waitForFunction(() => document.querySelector('[aria-label="챗봇 대화 기록"] [aria-current="page"]')?.textContent?.includes("검증 대화 2"));
    passed.push("대화 전환·뒤로가기·앞으로가기의 URL/선택 일치");

    if (await review.getByRole("textbox", { name: "용어집에 질문" }).isEnabled()) {
      await review.getByRole("textbox", { name: "용어집에 질문" }).fill("대화 2에서 보낸 질문");
      await review.getByRole("button", { name: "질문", exact: true }).click();
      await replyStarted;
      await review.goBack();
      await review.getByText("보존할 답변 1", { exact: true }).waitFor();
      releaseReply();
      await replyDone;
      await review.waitForFunction(() => !document.body.innerText.includes("답변 중…"));
      check(await review.getByText("늦은 답변 2", { exact: true }).count() === 0, "이전 대화의 답변이 현재 대화에 섞였습니다.");
      passed.push("응답 대기 중 뒤로가도 다른 대화의 답변이 섞이지 않음");
      await review.goForward();
      await review.getByText("보존할 답변 2", { exact: true }).waitFor();
    } else skipped.push("AI 비활성: 응답 대기 중 대화 이동");

    loadMode = "slow";
    await review.getByRole("button", { name: /검증 대화 1/ }).click();
    await started;
    await review.getByRole("button", { name: /검증 대화 2/ }).click();
    releaseSlow();
    await slowDone;
    await review.waitForFunction(() => document.querySelector('[aria-label="챗봇 대화 기록"] [aria-current="page"]')?.textContent?.includes("검증 대화 2") && !document.body.innerText.includes("대화 기록을 불러오는 중…"));
    check(review.url() === `${base}/c/${ids[1]}`, "늦은 응답이 현재 대화를 바꿨습니다.");
    passed.push("늦게 도착한 이전 대화 응답 무시");
    loadMode = "failure";
    await review.getByRole("button", { name: /검증 대화 1/ }).click();
    await review.getByRole("button", { name: "다시 불러오기", exact: true }).waitFor();
    loadMode = "success";
    await review.getByRole("button", { name: "다시 불러오기", exact: true }).click();
    await review.waitForFunction(() => document.querySelector('[aria-label="챗봇 대화 기록"] [aria-current="page"]')?.textContent?.includes("검증 대화 1") && !document.body.innerText.includes("검증용 일시 장애"));
    passed.push("대화 조회 실패 후 재시도");
    deleteMode = "success";
    await review.getByRole("button", { name: "대화 지우기", exact: true }).click();
    await review.waitForURL(`${base}/chat`);
    check(deleteRequests === 2, "삭제 재시도가 실행되지 않았습니다.");
    check(await review.getByRole("button", { name: "대화 지우기", exact: true }).count() === 0, "삭제 후 빈 대화로 돌아오지 않았습니다.");
    passed.push("대화 삭제 성공 후 새 대화 상태");
    if (await review.getByRole("textbox", { name: "용어집에 질문" }).isEnabled()) {
      replyMode = "failure";
      await review.getByRole("textbox", { name: "용어집에 질문" }).fill("첫 질문 실패 검증");
      await review.getByRole("button", { name: "질문", exact: true }).click();
      await review.getByText("답변 실패 검증", { exact: true }).waitFor();
      check(review.url().endsWith("/c/33333333-3333-4333-8333-333333333333"), "실패한 첫 질문의 대화 URL이 반영되지 않았습니다.");
      check(await review.getByText("첫 질문 실패 검증", { exact: true }).count() > 0, "대화 URL 변경 중 질문을 잃었습니다.");
      passed.push("첫 답변 실패 후 URL·질문·오류 안내 보존");
    } else skipped.push("AI 비활성: 첫 답변 실패 후 상태 보존");
    return { passed: passed.length, checks: passed, skipped };
  } finally {
    releaseSlow?.();
    releaseReply?.();
    await review.close();
  }
}
