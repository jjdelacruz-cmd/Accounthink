// End-to-end run of the whole app in phone-sized Chromium against a local Supabase.
//   BASE=http://localhost:3200 DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/e2e.mjs
// Instructor + three students, each in its own browser context. Prints PASS/FAIL per step.
// Playwright is not a project dependency (Netlify would download browsers on every build);
// point PLAYWRIGHT_PATH at an installed copy if "playwright" isn't resolvable.
import { execFileSync } from "node:child_process";

const { chromium, devices } = await import(process.env.PLAYWRIGHT_PATH ?? "playwright");

const BASE = process.env.BASE ?? "http://localhost:3200";
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SHOTS = process.env.SHOTS ?? "/tmp";
const run = Date.now().toString(36);
const PW = "trial-pass-123";

let failed = 0;
const results = [];
function ok(name, pass, detail = "") {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  console.log(results.at(-1));
  if (!pass) failed++;
}
const sql = (q) => execFileSync("psql", [DB_URL, "-tAc", q], { encoding: "utf8" }).trim();

const browser = await chromium.launch();
const phone = devices["iPhone 13"];
const newUser = async () => {
  const ctx = await browser.newContext({ ...phone, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  return { ctx, page };
};

async function signup(page, name, email, studentNo = "") {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Full name (Last, First M.I.)", { exact: true }).fill(name);
  if (studentNo) await page.getByLabel("Student number (students only)", { exact: true }).fill(studentNo);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password (min. 8 characters)", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/(student|instructor)/);
}
async function login(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
const leaveAndReturn = async (page, awayMs = 1200) => {
  const set = (v) =>
    page.evaluate((state) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
  await set("hidden");
  await page.waitForTimeout(awayMs);
  await set("visible");
};

try {
  // ---------------------------------------------------------------- instructor
  const T = await newUser();
  const instEmail = `inst.${run}@test.local`;
  await signup(T.page, "Dela Cruz, J.", instEmail);
  sql(`update public.profiles set role = 'admin' where email = '${instEmail}'`);
  // Already signed in by sign-up; the role is read fresh on every page load.
  await T.page.goto(`${BASE}/`);
  await T.page.waitForURL(/\/instructor$/);
  const seen = (loc) => loc.waitFor().then(() => true).catch(() => false);
  ok("Admin lands on My courses", await seen(T.page.getByRole("heading", { name: "My courses" })));
  ok("Manage users button visible to admin", await seen(T.page.getByRole("link", { name: "Manage users" })));

  await T.page.getByLabel("Course code", { exact: true }).fill("AUDI314");
  await T.page.getByLabel("Course title", { exact: true }).fill("Auditing and Assurance");
  await T.page.getByRole("button", { name: "Add course" }).click();
  await T.page.getByText("Added AUDI314.").waitFor();
  await T.page.getByText("+ Add section").click();
  await T.page.getByLabel("Section", { exact: true }).fill("TEST-1");
  await T.page.getByRole("button", { name: "Add section" }).click();
  await T.page.getByText("Added section TEST-1.").waitFor();
  const joinCode = (await T.page.locator('[title="Join code"]').first().innerText()).trim();
  ok("Course + section created, join code shown", /^[A-Z2-9]{6}$/.test(joinCode), joinCode);

  // Import items
  await T.page.getByRole("link", { name: "Item bank" }).click();
  await T.page.getByRole("link", { name: "⬆ Import" }).click();
  await T.page.locator("textarea").fill(`1. Which is the MOST reliable audit evidence?
A. Oral representations from management
B. Confirmations received directly from third parties
C. Internally generated documents
D. None of the above
ANSWER: B

2. Which is an asset?
A. Revenue   B. Cash   C. Expense   D. Dividends
ANSWER: B

3. The assumption that the entity will continue operating for the foreseeable future.
ANSWER: Going concern / Going concern assumption

4. Give three current assets.
ANSWER: Cash; Receivables / Accounts receivable; Inventory`);
  await T.page.getByRole("button", { name: "Import 4 questions" }).click();
  await T.page.getByText("Imported 4 questions.").waitFor();
  ok("Bulk import of 4 questions", true);

  // Exam
  await T.page.getByRole("link", { name: "Exams" }).click();
  await T.page.getByLabel("Title", { exact: true }).fill("Trial Quiz");
  await T.page.getByRole("button", { name: "Create exam" }).click();
  await T.page.waitForURL(/\/exams\/[0-9a-f-]{36}$/);
  const examUrl = T.page.url();
  await T.page.getByRole("button", { name: "Select all shown" }).click();
  await T.page.getByRole("button", { name: "Add 4 selected" }).click();
  await T.page.getByText("Every active item in the bank is already in this exam.").waitFor();
  await T.page.getByLabel("Time limit (minutes)", { exact: true }).fill("10");
  await T.page.getByLabel("TEST-1", { exact: true }).check();
  await T.page.getByLabel(/Require the rotating access code/).check();
  await T.page.getByLabel(/Auto-submit after leaving/).fill("3");
  await T.page.getByRole("button", { name: "Save & publish" }).click();
  await T.page.getByText("Saved and published.").waitFor();
  ok("Save & publish in one step", true);

  await T.page.goto(examUrl);
  await T.page.getByRole("link", { name: "Live monitor" }).click();
  await T.page.getByText("Access code", { exact: true }).waitFor();
  const codeEl = T.page.locator(".font-mono.text-5xl");
  await T.page.waitForFunction((el) => /\d{3} \d{3}/.test(el.textContent ?? ""), await codeEl.elementHandle());
  const readCode = async () => (await codeEl.innerText()).replace(/\s/g, "");
  let code = await readCode();
  ok("Monitor shows a 6-digit access code", /^\d{6}$/.test(code), code);

  // ---------------------------------------------------------------- students
  const students = [];
  for (const [i, name] of ["Aquino, Maria", "Bautista, Jose", "Cruz, Ana"].entries()) {
    const S = await newUser();
    S.email = `s${i + 1}.${run}@test.local`;
    await signup(S.page, name, S.email, `2023-0100${i + 1}`);
    await S.page.getByLabel("Join code from your instructor", { exact: true }).fill(joinCode.toLowerCase());
    await S.page.getByRole("button", { name: "Join" }).click();
    await S.page.getByText("You joined the section.").waitFor();
    students.push(S);
  }
  ok("3 students signed up and joined (lowercase code accepted)", true);

  const start = async (S) => {
    await S.page.goto(`${BASE}/student`);
    await S.page.getByRole("link", { name: /Trial Quiz/ }).click();
    code = await readCode();
    await S.page.getByLabel("Access code (shown by your instructor)", { exact: true }).fill(code);
    await S.page.getByRole("button", { name: "Start exam" }).click();
    await S.page.getByText(/Question 1 of 4/).waitFor();
  };

  // Wrong code first
  const [A, B, C] = students;
  await A.page.goto(`${BASE}/student`);
  await A.page.getByRole("link", { name: /Trial Quiz/ }).click();
  await A.page.getByLabel("Access code (shown by your instructor)", { exact: true }).fill("000000");
  await A.page.getByRole("button", { name: "Start exam" }).click();
  ok("Wrong access code refused",
    await A.page.getByText("Wrong or expired access code").waitFor().then(() => true).catch(() => false));

  for (const S of students) await start(S);
  ok("All 3 started with the rotating code", true);
  ok("Watermark shows name + student no.", await A.page.getByText("Aquino, Maria · 2023-01001").first().count() > 0);

  // ---- Student A answers everything (order may be shuffled) and submits
  const answerCurrent = async (page, perfect) => {
    const stem = await page.locator("main p.whitespace-pre-line").first().innerText();
    if (await page.getByRole("radio").count()) {
      const want = /reliable/.test(stem) ? "Confirmations received directly from third parties" : "Cash";
      await page.getByRole("radio", { name: perfect ? new RegExp(want) : /Revenue|Oral/ }).first().click();
    } else if (await page.getByPlaceholder("Type your answer").count()) {
      await page.getByPlaceholder("Type your answer").fill(perfect ? "  going CONCERN. " : "continuity");
    } else {
      const boxes = page.locator("main input");
      const vals = perfect ? ["inventory", "Accounts receivable", "cash"] : ["Cash", "Land", ""];
      for (let i = 0; i < 3; i++) await boxes.nth(i).fill(vals[i]);
    }
    await page.waitForTimeout(900); // debounce + save
  };
  for (let i = 0; i < 4; i++) {
    await answerCurrent(A.page, true);
    if (i < 3) await A.page.getByRole("button", { name: "Next →" }).click();
    await A.page.waitForTimeout(400);
  }
  await A.page.getByText("Saved ✓").waitFor();
  ok("Autosave indicator shows Saved", true);

  await leaveAndReturn(A.page);
  ok("Leaving the app shows a warning", await A.page.getByText("You left the exam screen.").isVisible());
  await A.page.evaluate(() => document.dispatchEvent(new Event("paste", { cancelable: true, bubbles: true })));
  ok("Paste is blocked with a notice", await A.page.getByText("Pasting is disabled during the exam.").isVisible());
  await A.page.waitForTimeout(5500); // event flush

  await A.page.getByRole("button", { name: "Submit", exact: true }).click();
  await A.page.getByText("All questions answered.").waitFor();
  await A.page.getByRole("button", { name: "Submit", exact: true }).last().click();
  await A.page.getByText("Submitted", { exact: true }).waitFor();
  const scoreA = await A.page.locator("p.text-5xl").innerText();
  ok("Student A: perfect score after grading variants (case, spaces, order)", /^6\s*\/\s*6$/.test(scoreA.replace(/\n/g, "")), scoreA.replace(/\n/g, " "));

  // ---- Student B: answer one wrong, then open on a second "device"
  await answerCurrent(B.page, false);
  const B2 = await newUser();
  await B2.ctx.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 99 }));
  await login(B2.page, B.email, PW);
  await B2.page.waitForURL(/\/student$/);
  await B2.page.getByRole("link", { name: /Trial Quiz/ }).click();
  await B2.page.getByRole("link", { name: "Continue exam" }).click();
  await B2.page.getByText("Enter the access code").waitFor();
  ok("Second device must enter the access code", true);
  code = await readCode();
  await B2.page.getByPlaceholder("000000").fill(code);
  await B2.page.getByRole("button", { name: "Continue" }).click();
  await B2.page.getByText(/Question 1 of 4/).waitFor();
  await B.page.getByRole("button", { name: "Next →" }).click();
  const kicked = await B.page.getByText("This exam is open on another device or tab").waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok("First device is locked out after the switch", kicked);
  const bAnswerKept =
    (await B2.page.getByRole("radio", { checked: true }).count()) === 1 ||
    (await B2.page.locator("main input").evaluateAll((els) => els.some((e) => e.value.trim() !== "")));
  ok("Answer saved on device 1 is there on device 2", bAnswerKept);

  // ---- Monitor: flags + extend C
  await T.page.waitForTimeout(6000);
  const rowA = T.page.locator("li", { hasText: "Aquino, Maria" }).first();
  const rowB = T.page.locator("li", { hasText: "Bautista, Jose" }).first();
  ok("Monitor: A shows leave + copy/paste flags",
    (await rowA.getByText(/Left 1×/).count()) > 0 && (await rowA.getByText(/Copy\/paste ×1/).count()) > 0);
  ok("Monitor: A shows 6 / 6", (await rowA.getByText("6 / 6").count()) > 0);
  ok("Monitor: B shows device flag", (await rowB.getByText(/Device\/tab ×/).count()) > 0);

  const clockC = async () => (await C.page.getByRole("timer").innerText()).trim();
  const before = await clockC();
  await T.page.locator("li", { hasText: "Cruz, Ana" }).first().getByRole("button", { name: "+5 min" }).click();
  await C.page.waitForTimeout(17000); // heartbeat every 15 s
  const after = await clockC();
  const mins = (s) => Number(s.split(":")[0]);
  ok("+5 min reaches the student's timer", mins(after) >= mins(before) + 4, `${before} → ${after}`);

  // ---- Student C leaves 3 times -> auto-submit
  for (let i = 0; i < 3; i++) {
    await leaveAndReturn(C.page, 400);
    await C.page.waitForTimeout(300);
  }
  const autoSubmitted = await C.page.waitForURL(/\/student\/exams\//, { timeout: 20000 }).then(() => true).catch(() => false);
  ok("Leaving 3 times auto-submits", autoSubmitted);
  ok("Student sees why it ended",
    await C.page.getByText(/Auto-submitted: left the exam too many times/).isVisible().catch(() => false));

  // ---- Instructor ends B
  await T.page.waitForTimeout(5500);
  T.page.once("dialog", (d) => d.accept());
  await T.page.locator("li", { hasText: "Bautista, Jose" }).first().getByRole("button", { name: "End now" }).click();
  const ended = await B2.page.getByText(/Submitting|Submitted/).first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  ok("End now stops the student's exam", ended);

  // ---- Results
  await T.page.goto(`${examUrl}/results`);
  await T.page.getByText("Took the exam").waitFor();
  ok("Results: 3/3 took the exam", (await T.page.getByText("3/3").count()) > 0);
  const [dl] = await Promise.all([T.page.waitForEvent("download"), T.page.getByRole("button", { name: /Download Excel/ }).click()]);
  ok("Excel download named after the exam", dl.suggestedFilename() === "AUDI314 Trial Quiz results.xlsx", dl.suggestedFilename());
  await T.page.getByRole("button", { name: /Item analysis/ }).click();
  ok("Item analysis lists 4 items", (await T.page.getByRole("link", { name: "Edit item" }).count()) === 4);
  await T.page.getByRole("button", { name: /Scores/ }).click();
  await T.page.getByRole("link", { name: /Aquino, Maria/ }).click();
  await T.page.getByText("Their answer:").first().waitFor();
  ok("Per-student review opens with answers and key", (await T.page.getByText("✓ 1/1").count()) >= 2);
  await T.page.screenshot({ path: `${SHOTS}/e2e-review.png`, fullPage: true });

  // ---- Password reset
  await T.page.goto(examUrl.replace(/\/exams\/.*/, "/students"));
  T.page.once("dialog", (d) => d.accept());
  await T.page.locator("li", { hasText: "Aquino, Maria" }).getByRole("button", { name: "Reset password" }).click();
  const temp = (await T.page.locator("b.font-mono").innerText()).trim();
  ok("Instructor gets a temporary password", /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(temp), temp);
  const A2 = await newUser();
  await login(A2.page, A.email, PW);
  ok("Old password stops working", await A2.page.getByText("Invalid login credentials").waitFor().then(() => true).catch(() => false));
  await login(A2.page, A.email, temp);
  await A2.page.waitForURL(/\/student$/);
  ok("Temporary password works", true);
  await A2.page.getByRole("link", { name: "Account" }).click();
  await A2.page.getByLabel("New password (min. 8 characters)", { exact: true }).fill("my-own-pass-9");
  await A2.page.getByLabel("Type it again", { exact: true }).fill("my-own-pass-9");
  await A2.page.getByRole("button", { name: "Change password" }).click();
  await A2.page.getByText("Password changed.").waitFor();
  const A3 = await newUser();
  await login(A3.page, A.email, "my-own-pass-9");
  ok("Student's own new password works", await A3.page.waitForURL(/\/student$/).then(() => true).catch(() => false));

  // ---- Login error keeps the email
  const L = await newUser();
  await login(L.page, A.email, "wrong-password");
  await L.page.getByText("Invalid login credentials").waitFor();
  ok("Wrong password keeps the email typed", (await L.page.getByLabel("Email", { exact: true }).inputValue()) === A.email);

  // ---- PWA
  const manifest = await (await L.page.request.get(`${BASE}/manifest.webmanifest`)).json();
  ok("Manifest is installable (standalone, 192+512 icons)",
    manifest.display === "standalone" && manifest.icons.some((i) => i.sizes === "512x512"));
  await L.page.goto(`${BASE}/login`);
  const swReady = await L.page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  ok("Service worker installs", swReady);
  // Playwright's setOffline doesn't reach service-worker fetches, so check the fallback is
  // in place (worker controls the page, offline page precached) rather than cutting the network.
  await L.page.reload();
  const offlineReady = await L.page.evaluate(async () => {
    const hit = await caches.match("/offline");
    return !!navigator.serviceWorker.controller && !!hit && (await hit.text()).includes("offline");
  });
  ok("Offline page is cached and the worker controls the page", offlineReady);
} catch (e) {
  ok("Run aborted", false, String(e).split("\n")[0]);
  // Screenshot every open page to see where it stopped.
  let n = 0;
  for (const ctx of browser.contexts())
    for (const pg of ctx.pages()) {
      const file = `${SHOTS}/e2e-abort-${++n}.png`;
      await pg.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.log(`  page ${n}: ${pg.url()} -> ${file}`);
    }
} finally {
  await browser.close();
  console.log(`\n${failed ? `${failed} FAILED` : "ALL PASS"} (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
