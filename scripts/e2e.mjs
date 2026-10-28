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
// Emails: the app must be started with SMTP_* pointing at a test inbox (Supabase's local Mailpit) and the same
// CRON_SECRET. Mailpit's web API lets this script read what was "sent".
const MAILPIT = process.env.MAILPIT ?? "http://127.0.0.1:54324";
const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret-123";
const findMail = async (query) => (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`)).json()).messages ?? [];
const mailBcc = async (id) => ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()).Bcc ?? []).map((x) => x.Address);
const waitMail = async (query, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const m = await findMail(query);
    if (m.length) return m;
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
};

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

// Fake camera (a test pattern with no face) so the camera check and warnings can run.
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
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

await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
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
  await T.page.getByRole("link", { name: "Items", exact: true }).click();
  await T.page.getByRole("link", { name: "Import", exact: true }).click();
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
  await T.page.getByPlaceholder("e.g. Chapter 3 quiz – Audit evidence").fill("Trial set");
  await T.page.getByRole("button", { name: "Import 4 questions" }).click();
  await T.page.getByText("Imported 4 questions as “Trial set”.").waitFor();
  ok("Import is saved as a named upload and shown filtered", (await T.page.getByText("4 items in “Trial set”").count()) > 0);
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
  ok("Feedback is held until the exam closes (default)",
    (await A.page.getByText(/review your right and wrong answers here after the exam closes/).count()) > 0 &&
    (await A.page.getByText("Your answers").count()) === 0);

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
    await C.page.getByText(/Auto-submitted: left the exam too many times/).waitFor().then(() => true).catch(() => false));

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

  // ---- Student feedback: release right after submitting, then check what students see
  await T.page.goto(examUrl);
  await T.page.getByLabel(/^Show the feedback/).selectOption("after_submit");
  await T.page.getByRole("button", { name: "Save settings" }).click();
  await T.page.getByText("Settings saved.").waitFor();
  await A.page.reload();
  await A.page.getByText("Your answers").waitFor();
  ok("Student sees per-question feedback: all 4 right",
    (await A.page.getByText("4 right").count()) > 0 && (await A.page.getByText(/✓ Correct/).count()) === 4);
  await C.page.reload();
  await C.page.getByText("Your answers").waitFor();
  await C.page.getByRole("button", { name: /Mistakes only/ }).click();
  ok("Student with mistakes sees wrong marks and the correct answers",
    (await C.page.getByText(/✗ Wrong/).count()) > 0 &&
    ((await C.page.getByText("correct answer", { exact: true }).count()) > 0 ||
      (await C.page.getByText("Correct answer:").count()) > 0));
  await C.page.screenshot({ path: `${SHOTS}/e2e-feedback.png`, fullPage: true });
  await T.page.getByLabel(/^After submitting, students see/).selectOption("marks");
  await T.page.getByRole("button", { name: "Save settings" }).click();
  // "Settings saved." is still showing from the last save, so wait until students see the change.
  for (let i = 0; i < 10; i++) {
    await C.page.reload();
    await C.page.getByText("Your answers").waitFor();
    if (await C.page.getByText(/chose not to show the correct answers/).count()) break;
    await C.page.waitForTimeout(1000);
  }
  ok("Right/wrong only: correct answers hidden",
    (await C.page.getByText("Correct answer:").count()) === 0 &&
    (await C.page.getByText("correct answer", { exact: true }).count()) === 0 &&
    (await C.page.getByText(/chose not to show the correct answers/).count()) > 0);

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

  // ---- Uploads + deleting questions
  const bankUrl = examUrl.replace(/\/exams\/.*/, "/items");
  await T.page.goto(bankUrl);
  await T.page.locator("summary", { hasText: "Uploads" }).click();
  ok("Uploads panel lists the upload with its count", (await T.page.getByText("4 questions · Pasted").count()) > 0);

  // All 4 are in the published exam: deleting the upload must keep them.
  T.page.once("dialog", (d) => d.accept());
  await T.page.getByRole("button", { name: "Delete upload" }).first().click();
  const keptMsg = await T.page.getByText(/Deleted 0 questions; kept 4 used in a published exam/).waitFor().then(() => true).catch(() => false);
  ok("Questions used in a published exam are protected from deletion", keptMsg);

  // A second upload, then delete one question, then select-and-delete, then the upload.
  await T.page.getByRole("link", { name: "Import", exact: true }).click();
  await T.page.locator("textarea").fill("1. Extra one?\nANSWER: a\n2. Extra two?\nANSWER: b\n3. Extra three?\nANSWER: c");
  await T.page.getByPlaceholder("e.g. Chapter 3 quiz – Audit evidence").fill("Extra set");
  await T.page.getByRole("button", { name: "Import 3 questions" }).click();
  await T.page.getByText("Imported 3 questions as “Extra set”.").waitFor();

  T.page.once("dialog", (d) => d.accept());
  await T.page.locator("div.card", { hasText: "Extra one?" }).getByRole("button", { name: "Delete" }).click();
  await T.page.getByText("Deleted 1 question.").waitFor();
  ok("Delete a single question", await T.page.getByText("Extra one?").waitFor({ state: "detached" }).then(() => true).catch(() => false));

  await T.page.getByLabel(/Select all shown/).check();
  ok("Select all shows the bulk bar", (await T.page.getByText("2 selected").count()) > 0);
  T.page.once("dialog", (d) => d.accept());
  await T.page.locator("div.fixed").getByRole("button", { name: "Delete" }).click();
  await T.page.getByText("Deleted 2 questions.").waitFor();
  ok("Delete selected questions", await T.page.getByText(/Extra (two|three)\?/).first().waitFor({ state: "detached" }).then(() => true).catch(() => false));

  // The now-empty upload can be deleted; the protected one stays.
  await T.page.goto(bankUrl);
  await T.page.locator("summary", { hasText: "Uploads" }).click();
  T.page.once("dialog", (d) => d.accept());
  await T.page.locator("li", { hasText: "Extra set" }).getByRole("button", { name: "Delete upload" }).click();
  ok("Empty upload can be deleted", await T.page.getByText(/Deleted 0 questions and the upload/).waitFor().then(() => true).catch(() => false));
  await T.page.goto(bankUrl);
  await T.page.locator("summary", { hasText: "Uploads" }).click();
  ok("Deleted upload is gone; protected one remains",
    (await T.page.locator("li", { hasText: "Extra set" }).count()) === 0 &&
    (await T.page.locator("li", { hasText: "Trial set" }).count()) === 1);

  // ---- Essays, camera monitoring and checking answers by hand
  await T.page.goto(bankUrl);
  await T.page.getByRole("link", { name: "Import", exact: true }).click();
  await T.page.locator("textarea").fill(`1. Explain the going concern assumption.
TYPE: Essay
POINTS: 4
ANSWER: The entity continues; assets at cost

2. Define materiality in one word.
ANSWER: Materiality`);
  await T.page.getByPlaceholder("e.g. Chapter 3 quiz – Audit evidence").fill("Essay set");
  await T.page.getByRole("button", { name: "Import 2 questions" }).click();
  await T.page.getByText("Imported 2 questions as “Essay set”.").waitFor();
  ok("Essay imported with TYPE: Essay", (await T.page.getByText("Checked by hand · guide: The entity continues").count()) > 0);

  await T.page.goto(examUrl.replace(/\/exams\/.*/, "/exams"));
  await T.page.getByLabel("Title", { exact: true }).fill("Essay Quiz");
  await T.page.getByRole("button", { name: "Create exam" }).click();
  await T.page.waitForURL(/\/exams\/[0-9a-f-]{36}$/);
  const essayUrl = T.page.url();
  await T.page.getByLabel("Upload", { exact: true }).selectOption({ label: "⬆ Essay set (2)" });
  await T.page.getByRole("button", { name: "Select all shown" }).click();
  await T.page.getByRole("button", { name: "Add 2 selected" }).click();
  await T.page.getByText("Items in this exam").waitFor();
  await T.page.getByText("Explain the going concern assumption.").first().waitFor();
  await T.page.getByLabel("Time limit (minutes)", { exact: true }).fill("10");
  await T.page.getByLabel("TEST-1", { exact: true }).check();
  await T.page.getByLabel(/Camera monitoring/).check();
  await T.page.getByLabel(/^Show the feedback/).selectOption("after_submit");
  await T.page.getByRole("button", { name: "Save & publish" }).click();
  await T.page.getByText("Saved and published.").waitFor();

  const setCamera = async (on) => {
    await T.page.goto(essayUrl);
    await T.page.getByLabel(/Camera monitoring/).setChecked(on);
    await T.page.getByRole("button", { name: "Save settings" }).click();
    await T.page.getByText("Settings saved.").waitFor();
  };

  // Camera check before starting: the fake camera shows no face, so Start stays hidden.
  await C.page.goto(`${BASE}/student`);
  await C.page.getByRole("link", { name: /Essay Quiz/ }).last().click();
  ok("Students are told the exam uses the camera",
    await C.page.getByText("This exam uses your front camera").waitFor().then(() => true).catch(() => false));
  await C.page.getByRole("button", { name: "Turn on camera" }).click();
  const camChecked = await C.page.getByText("We can't see your face").first()
    .waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  ok("Camera check runs the face model on the phone and needs a face", camChecked);
  ok("Start stays hidden until the camera sees a face", (await C.page.getByRole("button", { name: "Start exam" }).count()) === 0);
  await C.page.screenshot({ path: `${SHOTS}/e2e-camera-check.png`, fullPage: true });

  // Start without the camera, then turn it on: the exam screen warns and logs it.
  await setCamera(false);
  await C.page.reload();
  await C.page.getByRole("button", { name: "Start exam" }).click();
  await C.page.getByText(/Question 1 of 2/).waitFor();
  await setCamera(true);
  await C.page.reload();
  await C.page.getByText(/Question 1 of 2/).waitFor();
  const warned = await C.page.getByRole("alert").filter({ hasText: "We can't see your face" })
    .waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  ok("Exam screen shows a camera warning when no face is seen", warned);
  await C.page.screenshot({ path: `${SHOTS}/e2e-camera-warning.png` });
  await C.page.waitForTimeout(6000); // event flush
  const camEvents = Number(sql(`select count(*) from public.integrity_events e join public.attempts a on a.id = e.attempt_id
    join public.exams x on x.id = a.exam_id where x.title = 'Essay Quiz' and e.kind = 'cam_no_face'`));
  ok("Camera warning is logged for the instructor", camEvents >= 1, `${camEvents} events`);
  await T.page.goto(`${essayUrl}/monitor`);
  ok("Live monitor shows the camera flag",
    await T.page.locator("li", { hasText: "Cruz, Ana" }).first().getByText(/Camera ×\d/).waitFor().then(() => true).catch(() => false));

  // C answers: a written essay and a wrong-by-key identification.
  for (let i = 0; i < 2; i++) {
    if (await C.page.getByPlaceholder("Write your answer").count()) {
      await C.page.getByPlaceholder("Write your answer").fill("The business is expected to keep operating, so assets are reported at cost.");
    } else {
      await C.page.getByPlaceholder("Type your answer").fill("materiality concept");
    }
    await C.page.waitForTimeout(900);
    if (i < 1) await C.page.getByRole("button", { name: "Next →" }).click();
  }
  await C.page.getByRole("button", { name: "Submit", exact: true }).click();
  await C.page.getByText("All questions answered.").waitFor();
  await C.page.getByRole("button", { name: "Submit", exact: true }).last().click();
  await C.page.getByText("Submitted", { exact: true }).waitFor();
  ok("Student sees the essay is still being checked",
    (await C.page.getByText(/1 answer is still being checked/).count()) > 0 && (await C.page.getByText("being checked").count()) > 0);

  // Instructor checks by hand.
  await T.page.goto(essayUrl);
  await T.page.getByRole("link", { name: /Check answers · 1 waiting/ }).click();
  await T.page.getByText("1 answer waiting to be checked.").waitFor();
  ok("Check answers page opens on the essay waiting to be checked",
    (await T.page.getByText("Your guide:").count()) > 0 && (await T.page.getByText("To check", { exact: true }).count()) > 0);
  const row = T.page.locator("li", { hasText: "Cruz, Ana" }).first();
  await row.getByLabel("Points").fill("3");
  await row.getByRole("button", { name: "+ Add a comment for the student" }).click();
  await row.getByPlaceholder(/Comment for the student/).fill("Good, also mention asset valuation.");
  await row.getByRole("button", { name: "Save" }).click();
  ok("Essay scored 3/4 by hand", await row.getByText("Saved ✓ · total 3/5").waitFor().then(() => true).catch(() => false));
  await T.page.getByRole("link", { name: /Identification/ }).click();
  const idRow = T.page.locator("li", { hasText: "Cruz, Ana" }).first();
  await idRow.getByText("materiality concept").waitFor();
  await idRow.getByRole("button", { name: "✓ 1" }).click();
  // Full marks now, so it leaves the "Not full marks" list.
  ok("Wrong-by-key identification accepted by hand",
    await T.page.getByText("materiality concept").waitFor({ state: "detached" }).then(() => true).catch(() => false));

  await C.page.reload();
  await C.page.getByText("Your answers").waitFor();
  const scoreC = (await C.page.locator("p.text-5xl").innerText()).replace(/\s/g, "");
  ok("Student's score includes the hand-checked answers", scoreC === "4/5", scoreC);
  ok("Student sees the instructor's comment",
    (await C.page.getByText("Good, also mention asset valuation.").count()) > 0 &&
    (await C.page.getByText(/still being checked/).count()) === 0);
  await C.page.screenshot({ path: `${SHOTS}/e2e-essay-feedback.png`, fullPage: true });

  // ======================================================== Checker, photo, messages, announcements, emails
  const idOf = (email) => sql(`select id from public.profiles where email = '${email}'`);
  const trialId = examUrl.split("/").pop();
  const essayId = essayUrl.split("/").pop();
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  // ---- Email on publish: "new exam" went to the three students
  const newExamMails = await waitMail('subject:"New exam: Essay Quiz"');
  ok("Publishing emails the students about the new exam", newExamMails.length >= 1);
  const newExamBcc = newExamMails.length ? await mailBcc(newExamMails[0].ID) : [];
  ok("The email goes to all 3 students in BCC (nobody sees the others)", newExamBcc.length === 3 && !newExamMails[0].To.some((t) => t.Address.includes("test.local")), newExamBcc.join(","));

  // ---- Student photo
  await setCamera(false);
  await A3.page.goto(`${BASE}/account`);
  // The photo button is enabled once the page has loaded its scripts.
  await A3.page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /photo/i.test(b.textContent ?? "") && !b.disabled));
  await A3.page.getByLabel("Choose a photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  ok("Student saves a photo", await A3.page.getByText("Photo saved ✓").waitFor().then(() => true).catch(() => false));
  const avLen = Number(sql(`select length(avatar) from public.profiles where email = '${A.email}'`));
  ok("The photo is stored as a small JPEG (under 30 KB)", avLen > 100 && avLen < 30000, `${avLen} chars`);
  await A3.page.reload();
  ok("The photo shows in the header", (await A3.page.locator("header img").count()) === 1);
  await T.page.goto(examUrl.replace(/\/exams\/.*/, "/students"));
  ok("The instructor sees the student's photo", (await T.page.locator("li", { hasText: "Aquino, Maria" }).first().locator("img").count()) === 1);
  await A3.page.getByRole("button", { name: "Remove" }).click();
  ok("Student removes the photo", await A3.page.getByText("Photo removed").waitFor().then(() => true).catch(() => false));
  await A3.page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /photo/i.test(b.textContent ?? "") && !b.disabled));
  await A3.page.getByLabel("Choose a photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await A3.page.getByText("Photo saved ✓").waitFor();

  // ---- Messages: student <-> instructor only
  await A3.page.goto(`${BASE}/messages`);
  await A3.page.getByText("Students can't message each other.").waitFor();
  if (await A3.page.getByRole("button", { name: "＋ New message" }).count()) await A3.page.getByRole("button", { name: "＋ New message" }).click();
  await A3.page.getByRole("link", { name: /Dela Cruz, J\./ }).click();
  await A3.page.getByPlaceholder("Write a message").fill("Good day sir, may I ask about the essay?");
  await A3.page.getByRole("button", { name: "Send" }).click();
  ok("Student messages the instructor", await A3.page.getByText("Good day sir, may I ask about the essay?").waitFor().then(() => true).catch(() => false));
  await A3.page.goto(`${BASE}/messages/${idOf(B.email)}`);
  ok("Student can't open a conversation with another student",
    await A3.page.getByText("Page not found").waitFor().then(() => true).catch(() => false));
  const triedDirect = sql(`select count(*) from public.messages m join public.profiles p on p.id = m.recipient_id where p.email = '${B.email}'`);
  ok("No message to another student exists", triedDirect === "0");

  await T.page.goto(`${BASE}/messages`);
  ok("Instructor sees an unread badge on Messages", await T.page.getByLabel("1 unread").first().waitFor().then(() => true).catch(() => false));
  await T.page.getByRole("link", { name: /Aquino, Maria/ }).click();
  await T.page.getByText("Good day sir, may I ask about the essay?").waitFor();
  await T.page.getByPlaceholder("Write a message").fill("Yes, go ahead.");
  await T.page.getByRole("button", { name: "Send" }).click();
  // Wait until the reply is really saved (the text is also visible in the box while it is being typed).
  for (let i = 0; i < 40 && sql(`select count(*) from public.messages m join public.profiles p on p.id = m.recipient_id where m.body = 'Yes, go ahead.' and p.email = '${A.email}'`) === "0"; i++) await T.page.waitForTimeout(250);
  await T.page.getByText("Yes, go ahead.").waitFor();
  await A3.page.goto(`${BASE}/messages`);
  const replyShown = await A3.page.getByText(/Yes, go ahead\./).first().waitFor().then(() => true).catch(() => false);
  ok("Student sees the instructor's reply in the inbox", replyShown, `${await A3.page.getByText(/Yes, go ahead\./).count()} match(es)`);
  if (!replyShown) console.log("  [debug] /messages shows:", (await A3.page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 400), "| url", A3.page.url());
  ok("...with an unread badge", (await A3.page.getByLabel("1 unread").count()) >= 1);
  await A3.page.getByRole("link", { name: /Dela Cruz, J\./ }).first().click();
  await A3.page.getByText("Yes, go ahead.").first().waitFor();
  await A3.page.screenshot({ path: `${SHOTS}/e2e-messages.png`, fullPage: true });

  // ---- Announcements (+ email, honoring "emails off")
  await B2.page.goto(`${BASE}/account`);
  await B2.page.getByLabel("Email me about exams and announcements").uncheck();
  await B2.page.getByRole("button", { name: "Save", exact: true }).last().click();
  ok("Student turns emails off", await B2.page.getByText(/Emails are off/).waitFor().then(() => true).catch(() => false));
  const annUrl = examUrl.replace(/\/exams\/.*/, "/announcements");
  await T.page.goto(annUrl);
  await T.page.getByLabel("Title", { exact: true }).fill("Quiz on Friday");
  await T.page.getByLabel("Message", { exact: true }).fill("Bring a calculator and a ballpen.");
  await T.page.getByRole("button", { name: "Post announcement" }).click();
  ok("Announcement is posted and emailed to the students who want email",
    await T.page.getByText("Posted and emailed 2 students; 1 turned emails off.").waitFor().then(() => true).catch(() => false));
  const annMail = await waitMail('subject:"Quiz on Friday"');
  const annBcc = annMail.length ? await mailBcc(annMail[0].ID) : [];
  ok("The email is addressed to the two students, not the one who opted out",
    annBcc.length === 2 && !annBcc.includes(B.email), annBcc.join(","));
  ok("The announcement shows in the list as emailed 2", (await T.page.getByText(/emailed 2/).count()) > 0);
  await C.page.goto(`${BASE}/student`);
  ok("Students see it on their dashboard", await C.page.getByText("Quiz on Friday").waitFor().then(() => true).catch(() => false));
  await C.page.getByText("Quiz on Friday").click();
  ok("...and can read the message", await C.page.getByText("Bring a calculator and a ballpen.").isVisible());
  await T.page.getByLabel("Title", { exact: true }).fill("Section-only note");
  await T.page.getByLabel("Message", { exact: true }).fill("No email for this one.");
  await T.page.getByLabel(/Also email the students/).uncheck();
  await T.page.getByRole("button", { name: "Post announcement" }).click();
  ok("An announcement can be posted without email",
    await T.page.getByText("Posted. Students see it in the app.").waitFor().then(() => true).catch(() => false));
  ok("...and no email is sent for it", (await findMail('subject:"Section-only note"')).length === 0);

  // ---- Automatic reminder 24 h before an exam opens
  sql(`insert into public.app_settings (key, value) values ('cron_secret', '${CRON_SECRET}') on conflict (key) do update set value = excluded.value`);
  sql(`update public.exams set opens_at = now() + interval '5 hours', reminded_at = null, notified_at = null where id = '${trialId}'`);
  const noAuth = await fetch(`${BASE}/api/cron/reminders`);
  ok("The reminder job refuses requests without the secret", noAuth.status === 401);
  const run1 = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json();
  ok("The hourly job emails the exam that opens within 24 hours", run1.exams === 1 && run1.emailed === 2, JSON.stringify(run1));
  const remMail = await waitMail('subject:"Reminder: Trial Quiz"');
  const remBcc = remMail.length ? await mailBcc(remMail[0].ID) : [];
  ok("The reminder skips the student who turned emails off", remBcc.length === 2 && !remBcc.includes(B.email), remBcc.join(","));
  const run2 = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json();
  ok("It doesn't send the same reminder twice", run2.exams === 0 && run2.emailed === 0, JSON.stringify(run2));
  sql(`update public.exams set opens_at = null where id = '${trialId}'`);

  // ---- Admin: email status and test email
  await T.page.goto(`${BASE}/admin`);
  ok("Admin sees that email is set up", await T.page.getByText(/Email is set up\. Sending as/).waitFor().then(() => true).catch(() => false));
  await T.page.getByRole("button", { name: "Send a test email to me" }).click();
  ok("Admin sends a test email", await T.page.getByText(/Sent to .*@test\.local/).waitFor().then(() => true).catch(() => false));
  ok("The test email arrives", (await waitMail('subject:"Accounthink test email"')).length === 1);

  // ---- Checker account: sees only assigned, already-taken exams
  const Ch = await newUser();
  Ch.email = `chk.${run}@test.local`;
  await signup(Ch.page, "Ramos, Checker", Ch.email);
  sql(`update public.profiles set role = 'checker' where email = '${Ch.email}'`);
  await Ch.page.goto(`${BASE}/`);
  ok("A checker account lands on the checker dashboard", await Ch.page.waitForURL(/\/checker$/).then(() => true).catch(() => false));
  ok("...which is empty until an instructor assigns an exam", (await Ch.page.getByText("Nothing yet.").count()) > 0);

  // Student A takes the Essay Quiz (camera is off again), so there is an essay to check.
  await A3.page.goto(`${BASE}/student`);
  await A3.page.getByRole("link", { name: /Essay Quiz/ }).last().click();
  await A3.page.getByRole("button", { name: "Start exam" }).click();
  await A3.page.getByText(/Question 1 of 2/).waitFor();
  for (let i = 0; i < 2; i++) {
    if (await A3.page.getByPlaceholder("Write your answer").count()) {
      await A3.page.getByPlaceholder("Write your answer").fill("The entity is expected to continue operating, so assets stay at cost.");
    } else {
      await A3.page.getByPlaceholder("Type your answer").fill("Materiality");
    }
    await A3.page.waitForTimeout(900);
    if (i < 1) await A3.page.getByRole("button", { name: "Next →" }).click();
  }
  await A3.page.getByRole("button", { name: "Submit", exact: true }).click();
  await A3.page.getByText("All questions answered.").waitFor();
  await A3.page.getByRole("button", { name: "Submit", exact: true }).last().click();
  await A3.page.getByText("Submitted", { exact: true }).waitFor();

  await T.page.goto(essayUrl);
  await T.page.getByLabel("Checker's email").fill(Ch.email);
  await T.page.getByRole("button", { name: "Add", exact: true }).click();
  ok("Instructor assigns the checker by email", await T.page.getByText("Ramos, Checker can now check this exam.").waitFor().then(() => true).catch(() => false));
  await Ch.page.reload();
  ok("The checker sees the assigned exam with answers waiting",
    await Ch.page.getByText("1 to check").waitFor().then(() => true).catch(() => false));
  ok("...and not the exam they weren't assigned", (await Ch.page.getByText("Trial Quiz").count()) === 0);
  await Ch.page.getByRole("link", { name: /Essay Quiz/ }).last().click();
  await Ch.page.getByText("Check answers").first().waitFor();
  ok("The checker sees the question, the guide and the answers",
    (await Ch.page.getByText("Your guide:").count()) > 0 && (await Ch.page.getByText("The entity is expected to continue operating").count()) > 0);
  ok("The checker can't see item bank links, exam settings or results",
    (await Ch.page.getByRole("link", { name: /Item bank|Results|Live monitor/ }).count()) === 0);
  await Ch.page.screenshot({ path: `${SHOTS}/e2e-checker.png`, fullPage: true });
  const chRow = Ch.page.locator("li", { hasText: "Aquino, Maria" }).first();
  await chRow.getByLabel("Points").fill("3");
  await chRow.getByRole("button", { name: "+ Add a comment for the student" }).click();
  await chRow.getByPlaceholder(/Comment for the student/).fill("Well explained.");
  await chRow.getByRole("button", { name: "Save", exact: true }).click();
  ok("The checker scores the essay", await chRow.getByText(/Saved ✓ · total/).waitFor().then(() => true).catch(() => false));
  await Ch.page.goto(`${BASE}/checker/exams/${trialId}`);
  ok("The checker can't open an exam that wasn't assigned", await Ch.page.getByText("Page not found").waitFor().then(() => true).catch(() => false));
  await Ch.page.goto(`${BASE}/instructor`);
  ok("The checker is kept out of the instructor area", await Ch.page.waitForURL(/\/checker$/).then(() => true).catch(() => false));
  await Ch.page.goto(`${BASE}/messages`);
  ok("The checker has no messages", await Ch.page.waitForURL(/\/checker$/).then(() => true).catch(() => false));
  await A3.page.goto(`${BASE}/student`);
  await A3.page.getByRole("link", { name: /Essay Quiz/ }).last().click();
  ok("The student sees the checker's score and comment",
    await A3.page.getByText("Well explained.").waitFor().then(() => true).catch(() => false));
  await T.page.goto(`${BASE}/instructor/courses/${essayUrl.split("/")[5]}/exams/${essayId}/results`);
  await T.page.getByRole("link", { name: /Aquino, Maria/ }).click();
  ok("The instructor sees that the checker scored it",
    await T.page.getByText(/by Ramos, Checker/).first().waitFor().then(() => true).catch(() => false));

  // ======================================================== Scores download (Excel) and score-change notices
  const { default: readXlsxFile, readSheet } = await import("read-excel-file/node");
  const courseId = examUrl.split("/")[5];
  const courseBase = `${BASE}/instructor/courses/${courseId}`;
  const dbScore = (email, title) =>
    Number(sql(`select a.score from public.attempts a join public.exams e on e.id = a.exam_id join public.profiles p on p.id = a.student_id
                where p.email = '${email}' and e.title = '${title}'`));

  // Put Cruz in a second section so the file gets a sheet per section.
  const sec2 = sql(`with s as (insert into public.sections (course_id, name) values ('${courseId}', 'TEST-2') returning id) select id from s`);
  sql(`update public.section_members set section_id = '${sec2}' where student_id = (select id from public.profiles where email = '${C.email}')`);

  await T.page.goto(`${courseBase}/exams`);
  await T.page.getByRole("link", { name: "Scores", exact: true }).click();
  await T.page.waitForURL(/\/scores$/);
  ok("Scores tab shows each student with each exam",
    (await T.page.getByRole("columnheader", { name: /Trial Quiz/ }).count()) === 1 &&
    (await T.page.getByRole("columnheader", { name: /Essay Quiz/ }).count()) === 1 &&
    (await T.page.getByRole("cell", { name: /Aquino, Maria/ }).count()) === 1 &&
    (await T.page.getByText("Average (of those who took it)").count()) === 1);
  await T.page.screenshot({ path: `${SHOTS}/e2e-scores.png`, fullPage: true });
  ok("Section buttons appear when there are 2 sections", (await T.page.getByRole("link", { name: "TEST-2", exact: true }).count()) === 1);
  await T.page.getByRole("link", { name: "TEST-2", exact: true }).click();
  await T.page.waitForURL(/scores\?section=/);
  ok("Choosing a section shows only its students",
    (await T.page.getByRole("cell", { name: /Cruz, Ana/ }).count()) === 1 && (await T.page.getByRole("cell", { name: /Aquino, Maria/ }).count()) === 0);
  await T.page.goto(`${courseBase}/scores`);

  const [gb] = await Promise.all([T.page.waitForEvent("download"), T.page.getByRole("button", { name: /Excel: AUDI314/ }).click()]);
  ok("Excel file is named after the subject", gb.suggestedFilename() === "AUDI314 scores.xlsx", gb.suggestedFilename());
  const gbFile = `${SHOTS}/e2e-scores.xlsx`;
  await gb.saveAs(gbFile);
  const names = (await readXlsxFile(gbFile)).map((x) => x.sheet);
  ok("Workbook: everyone, one sheet per section, Exams, Notes",
    JSON.stringify(names) === JSON.stringify(["All sections", "TEST-1", "TEST-2", "Exams", "Notes"]), JSON.stringify(names));
  const allRows = await readSheet(gbFile, "All sections");
  const col = (title) => allRows[0].findIndex((h) => String(h).startsWith(title));
  const rowOf = (rows, name) => rows.find((r) => String(r[2]).startsWith(name));
  const aq = rowOf(allRows, "Aquino");
  ok("Header shows each exam with its points", /\(6 pts\)/.test(String(allRows[0][col("Trial Quiz")])) && /\(5 pts\)/.test(String(allRows[0][col("Essay Quiz")])));
  ok("Aquino's scores match the database (both exams)",
    aq && aq[col("Trial Quiz")] === dbScore(A.email, "Trial Quiz") && aq[col("Essay Quiz")] === dbScore(A.email, "Essay Quiz"),
    JSON.stringify(aq));
  const cr = rowOf(allRows, "Cruz");
  ok("Cruz's scores match the database too", cr && cr[col("Trial Quiz")] === dbScore(C.email, "Trial Quiz") && cr[col("Essay Quiz")] === dbScore(C.email, "Essay Quiz"), JSON.stringify(cr));
  ok("Total and Overall % are worked out",
    aq && aq[col("Total")] === dbScore(A.email, "Trial Quiz") + dbScore(A.email, "Essay Quiz") && aq[col("Out of")] === 11 &&
    aq[col("Overall %")] === Math.round(((dbScore(A.email, "Trial Quiz") + dbScore(A.email, "Essay Quiz")) / 11) * 1000) / 10, JSON.stringify(aq));
  const sec1 = await readSheet(gbFile, "TEST-1");
  const sec2rows = await readSheet(gbFile, "TEST-2");
  ok("Each section sheet has only its own students",
    !!rowOf(sec1, "Aquino") && !rowOf(sec1, "Cruz") && !!rowOf(sec2rows, "Cruz") && !rowOf(sec2rows, "Aquino"));
  ok("Class average sits under the table", allRows.some((r) => String(r[3]).startsWith("Average")));
  const exSheet = await readSheet(gbFile, "Exams");
  ok("Exams sheet lists both exams", exSheet.length === 3 && exSheet.some((r) => r[1] === "Trial Quiz") && exSheet.some((r) => r[1] === "Essay Quiz"));
  const noteSheet = await readSheet(gbFile, "Notes");
  ok("Notes sheet explains the symbols", noteSheet.some((r) => String(r[0]).includes("ABS")));

  await T.page.goto(`${courseBase}/scores?section=${sec2}`);
  const [gbOne] = await Promise.all([T.page.waitForEvent("download"), T.page.getByRole("button", { name: /Excel: only TEST-2/ }).click()]);
  ok("A single section can be downloaded on its own", gbOne.suggestedFilename() === "AUDI314 TEST-2 scores.xlsx", gbOne.suggestedFilename());
  await gbOne.saveAs(`${SHOTS}/e2e-scores-section.xlsx`);
  const oneNames = (await readXlsxFile(`${SHOTS}/e2e-scores-section.xlsx`)).map((x) => x.sheet);
  ok("...with just that section, Exams and Notes", JSON.stringify(oneNames) === JSON.stringify(["TEST-2", "Exams", "Notes"]), JSON.stringify(oneNames));

  await T.page.goto(`${BASE}/instructor`);
  const [gbAll] = await Promise.all([T.page.waitForEvent("download"), T.page.getByRole("button", { name: /Scores of all my subjects/ }).click()]);
  ok("My courses has a download for all subjects", gbAll.suggestedFilename() === "Accounthink scores - all subjects.xlsx", gbAll.suggestedFilename());
  await gbAll.saveAs(`${SHOTS}/e2e-scores-all.xlsx`);
  ok("...and it contains the subject's scores", (await readXlsxFile(`${SHOTS}/e2e-scores-all.xlsx`)).some((x) => x.sheet === "All sections"));

  // ---- Students are told when their score is changed by hand
  await A3.page.goto(`${BASE}/student`);
  ok("The student sees a notice that the checker's scoring changed the score",
    await A3.page.getByText("Your score was updated").waitFor().then(() => true).catch(() => false) &&
    (await A3.page.getByText(/AUDI314 · Essay Quiz/).count()) >= 1 && (await A3.page.getByText("Your instructor checked or adjusted your answers.").count()) === 1);
  const oldNew = (await A3.page.locator("section[aria-label='Score updates']").innerText()).replace(/\s+/g, " ");
  ok("...showing old score → new score out of the total", /1\s*→\s*4\s*\/\s*5/.test(oldNew), oldNew.slice(0, 160));
  await A3.page.screenshot({ path: `${SHOTS}/e2e-score-notice.png`, fullPage: true });
  await A3.page.getByRole("button", { name: "Got it" }).click();
  await A3.page.getByText("Your score was updated").waitFor({ state: "detached" });
  await A3.page.reload();
  ok("Tapping Got it clears the notice for good", (await A3.page.getByText("Your score was updated").count()) === 0);

  // The instructor changes it again from the review page.
  await T.page.goto(`${essayUrl}/results`);
  await T.page.getByRole("link", { name: /Aquino, Maria/ }).click();
  const essayRow = T.page.locator("li", { hasText: "Explain the going concern assumption." }).first();
  await essayRow.getByLabel("Points").fill("4");
  await essayRow.getByRole("button", { name: "Save", exact: true }).click();
  ok("The instructor is told the student will be notified",
    await essayRow.getByText(/Saved ✓ · total 5\/5 · student will be notified/).waitFor().then(() => true).catch(() => false));
  await essayRow.getByRole("button", { name: "Save", exact: true }).click();
  ok("Saving the same score again does not claim to notify",
    await essayRow.getByText(/Saved ✓ · total 5\/5$/).waitFor().then(() => true).catch(() => false));
  await A3.page.goto(`${BASE}/student`);
  const oldNew2 = await A3.page.locator("section[aria-label='Score updates']").innerText().then((t) => t.replace(/\s+/g, " ")).catch(() => "");
  ok("A new notice appears for the new change: 4 → 5 / 5", /4\s*→\s*5\s*\/\s*5/.test(oldNew2), oldNew2.slice(0, 160));

  // ---- Email: one message per student, after the changes have settled
  const scoreRun0 = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json();
  ok("A fresh change is held back for 10 minutes before any email to that student",
    (await findMail('subject:"Your score in Essay Quiz was updated"')).length === 0, JSON.stringify(scoreRun0));
  sql(`update public.score_changes set created_at = now() - interval '20 minutes'`);
  const scoreRun1 = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json();
  ok("After 10 quiet minutes the hourly job emails the student", scoreRun1.scoreEmails >= 1 && (scoreRun1.failures ?? []).length === 0, JSON.stringify(scoreRun1));
  const scoreMails = await waitMail('subject:"Your score in Essay Quiz was updated"');
  // Each student gets their own email; find the one addressed to Aquino.
  let scoreMail = [];
  let scoreBcc = [];
  for (const m of scoreMails) {
    const bcc = await mailBcc(m.ID);
    if (bcc.includes(A.email)) { scoreMail = [m]; scoreBcc = bcc; break; }
  }
  ok("The email goes to that student only", scoreMail.length === 1 && scoreBcc.length === 1 && scoreBcc[0] === A.email, scoreMails.length + " score emails");
  const scoreText = scoreMail.length ? ((await (await fetch(`${MAILPIT}/api/v1/message/${scoreMail[0].ID}`)).json()).Text ?? "") : "";
  ok("It says how the score changed (all changes since the last email: 1 → 5 / 5)", /1 → 5 \/ 5/.test(scoreText) && /checked or adjusted/.test(scoreText), scoreText.replace(/\s+/g, " ").slice(0, 160));
  const scoreRun2 = await (await fetch(`${BASE}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON_SECRET}` } })).json();
  ok("The same change isn't emailed twice", scoreRun2.scoreEmails === 0, JSON.stringify(scoreRun2));

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
