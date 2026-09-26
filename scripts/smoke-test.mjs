// Live smoke test against the Supabase project in .env.local.
// Needs "Confirm email" OFF (or confirmed test accounts). Run: node scripts/smoke-test.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const client = () => createClient(URL_, KEY, { auth: { persistSession: false } });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

// 0. Reachability: a blocked network would make every "cannot" check pass falsely.
{
  const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } }).catch((e) => e);
  if (!(res instanceof Response) || !res.ok) {
    console.log(`Cannot reach ${URL_}: ${res instanceof Response ? `HTTP ${res.status}` : res.message}`);
    process.exit(2);
  }
}

// 1. Anonymous visitors see nothing.
const anon = client();
for (const t of ["profiles", "courses", "sections", "section_members"]) {
  const { data, error } = await anon.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !error && data.length === 0, error?.message);
}
{
  const { error } = await anon.rpc("join_section", { p_code: "ABC234" });
  check("anon cannot call join_section", !!error, error?.message);
}

// 2. Sign up a student (role in metadata must be ignored).
const stamp = Date.now();
const student = client();
const { data: su, error: suErr } = await student.auth.signUp({
  email: `smoke.student.${stamp}@example.com`,
  password: "smoke-test-pass-123",
  options: { data: { full_name: "Smoke, Student", student_no: "0000", role: "admin" } },
});
check("student sign-up", !suErr, suErr?.message);
if (!su?.session) {
  console.log("\nNo session after sign-up: turn OFF 'Confirm email' to run the rest.");
  process.exit(failed ? 1 : 0);
}
const uid = su.user.id;

const { data: me } = await student.from("profiles").select("*").eq("id", uid).single();
check("profile auto-created as student", me?.role === "student", `role=${me?.role}`);
check("name + student no. saved", me?.full_name === "Smoke, Student" && me?.student_no === "0000");

{
  const { error } = await student.from("profiles").update({ role: "admin" }).eq("id", uid);
  check("student cannot self-promote", !!error, error?.message);
}
{
  const { error } = await student.from("courses").insert({ instructor_id: uid, code: "X", title: "X" });
  check("student cannot create a course", !!error, error?.message);
}
{
  const { error } = await student.rpc("join_section", { p_code: "ZZZZZZ" });
  check("bad join code rejected", error?.message === "No section found for that code", error?.message);
}
{
  const { data } = await student.from("profiles").select("id");
  check("student sees only own profile", data?.length === 1, `saw ${data?.length}`);
}

console.log(`\n${failed ? `${failed} FAILED` : "All checks passed"}. Test user: smoke.student.${stamp}@example.com`);
process.exit(failed ? 1 : 0);
