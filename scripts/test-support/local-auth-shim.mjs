// A tiny stand-in for Supabase's auth service (GoTrue) + API gateway, for running the app against a bare
// Postgres (supabase/postgres image) and PostgREST when Docker can't pull the real auth image.
// Not used in production. It implements only what the app calls: sign up, password sign-in, refresh,
// get/update user, sign out, and it forwards /rest/v1/* to PostgREST.
//
//   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//   ADMIN_DB_URL=postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres \
//   POSTGREST=http://127.0.0.1:3300 PORT=54321 node scripts/test-support/local-auth-shim.mjs
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT ?? 54321);
const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ADMIN_DB_URL = process.env.ADMIN_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const POSTGREST = new URL(process.env.POSTGREST ?? "http://127.0.0.1:3300");
const SECRET = process.env.JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const ISS = `http://127.0.0.1:${PORT}/auth/v1`;

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const psql = (url, sql) => execFileSync("psql", [url, "-tAq", "-c", sql], { encoding: "utf8" }).trim();
const q = (sql) => psql(DB_URL, sql);

// The real auth service owns auth.sessions; the bare image doesn't have it.
psql(ADMIN_DB_URL, `create table if not exists auth.sessions (id uuid primary key, user_id uuid not null, created_at timestamptz default now());
  grant all on auth.sessions to postgres;`);

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const sign = (payload) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
};
const verify = (token) => {
  const [h, b, s] = String(token ?? "").split(".");
  if (!h || !b || !s || createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url") !== s) return null;
  const p = JSON.parse(Buffer.from(b, "base64url").toString());
  return p.exp && p.exp < Date.now() / 1000 ? null : p;
};
const anonJwt = sign({ role: "anon", iss: "supabase-demo", exp: 4102444800 });

const userRow = (email) => {
  const r = q(`select row_to_json(u) from (select id, email, raw_user_meta_data, created_at, updated_at from auth.users where lower(email) = lower(${lit(email)})) u`);
  return r ? JSON.parse(r) : null;
};
const userById = (id) => {
  const r = q(`select row_to_json(u) from (select id, email, raw_user_meta_data, created_at, updated_at from auth.users where id = ${lit(id)}) u`);
  return r ? JSON.parse(r) : null;
};
const publicUser = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.created_at,
  phone: "", confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {},
  identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
});
const newSession = (u) => {
  const sid = randomUUID();
  q(`insert into auth.sessions (id, user_id) values (${lit(sid)}, ${lit(u.id)})`);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: "authenticated", iss: ISS, iat: now, sub: u.id, email: u.email, phone: "", role: "authenticated",
    aal: "aal1", amr: [{ method: "password", timestamp: now }], session_id: sid, is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {},
  };
  return {
    access_token: sign({ ...claims, exp: now + 3600 }), token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    refresh_token: sign({ typ: "refresh", sub: u.id, session_id: sid, exp: now + 86400 * 30 }), user: publicUser(u),
  };
};
const sessionAlive = (sid) => q(`select 1 from auth.sessions where id = ${lit(sid)}`) === "1";

const readBody = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const authError = (res, status, code, msg) =>
  send(res, status, { code: status, error_code: code, msg, error: code, error_description: msg, message: msg });

async function auth(req, res, url) {
  const route = url.pathname.replace(/^\/auth\/v1/, "");
  const body = req.method === "GET" ? {} : JSON.parse((await readBody(req)).toString() || "{}");
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

  if (route === "/signup" && req.method === "POST") {
    if (!body.email || !body.password) return authError(res, 422, "validation_failed", "Email and password are required");
    if (String(body.password).length < 6) return authError(res, 422, "weak_password", "Password should be at least 6 characters.");
    if (userRow(body.email)) return authError(res, 422, "user_already_exists", "User already registered");
    q(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${lit(body.email)},
         extensions.crypt(${lit(body.password)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
         ${lit(JSON.stringify(body.data ?? {}))}::jsonb, now(), now())`);
    return send(res, 200, newSession(userRow(body.email)));
  }
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const ok = q(`select 1 from auth.users where lower(email) = lower(${lit(body.email ?? "")})
                    and encrypted_password = extensions.crypt(${lit(body.password ?? "")}, encrypted_password)`) === "1";
      if (!ok) return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      return send(res, 200, newSession(userRow(body.email)));
    }
    if (grant === "refresh_token") {
      const p = verify(body.refresh_token);
      if (!p || p.typ !== "refresh" || !sessionAlive(p.session_id)) return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      q(`delete from auth.sessions where id = ${lit(p.session_id)}`);
      return send(res, 200, newSession(userById(p.sub)));
    }
  }
  if (route === "/user") {
    const p = verify(bearer);
    if (!p || !p.session_id || !sessionAlive(p.session_id)) return authError(res, 401, "session_not_found", "Auth session missing!");
    if (req.method === "PUT") {
      if (body.password) {
        if (String(body.password).length < 6) return authError(res, 422, "weak_password", "Password should be at least 6 characters.");
        q(`update auth.users set encrypted_password = extensions.crypt(${lit(body.password)}, extensions.gen_salt('bf')), updated_at = now() where id = ${lit(p.sub)}`);
      }
    }
    return send(res, 200, publicUser(userById(p.sub)));
  }
  if (route === "/logout") {
    const p = verify(bearer);
    if (p?.session_id) q(`delete from auth.sessions where id = ${lit(p.session_id)}`);
    return send(res, 204);
  }
  if (route === "/settings") return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
  return authError(res, 404, "not_found", `No such auth route ${route}`);
}

function rest(req, res, url) {
  const headers = { ...req.headers, host: POSTGREST.host };
  // The app sends the project's publishable key when signed out; the real gateway swaps it for an anon token.
  if (!/^Bearer [^.]+\.[^.]+\.[^.]+$/.test(headers.authorization ?? "")) headers.authorization = `Bearer ${anonJwt}`;
  delete headers.apikey;
  const upstream = http.request({ host: POSTGREST.hostname, port: POSTGREST.port, method: req.method, path: url.pathname.replace(/^\/rest\/v1/, "") + url.search, headers }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, "access-control-allow-origin": "*" });
    r.pipe(res);
  });
  upstream.on("error", (e) => send(res, 502, { message: String(e) }));
  req.pipe(upstream);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
        return res.end();
      }
      if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url);
      if (url.pathname.startsWith("/rest/v1/")) return rest(req, res, url);
      send(res, 404, { message: "not found" });
    } catch (e) {
      console.error(e);
      send(res, 500, { message: String(e) });
    }
  })
  .listen(PORT, () => console.log(`auth shim on :${PORT} -> PostgREST ${POSTGREST.origin}`));
