// Outfitter accounts API - Cloudflare Worker.
//
// Auth model: pure resource server. The desktop app signs users in through
// hosted AuthKit (PKCE public client, system browser) and sends the AuthKit
// access token as a Bearer header. This Worker verifies it against WorkOS's
// JWKS and trusts only the verified claims - it holds no WorkOS secret.
//
// AuthKit access tokens carry NO `aud` claim by default, so verification is
// signature + issuer + expiry. `sub` (WorkOS user id) keys all data. Role and
// permission claims only exist for organization members; Outfitter users are
// standalone consumers, so authorization here is ownership plus a local
// is_admin flag.

import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

type Env = {
  DB: D1Database;
  WORKOS_CLIENT_ID: string;
  WORKOS_ISSUER: string;
  /** Fine-grained GitHub token (issues:write on TylerSander/outfitter).
   *  Optional: /feedback answers 501 until it is configured as a secret. */
  GITHUB_FEEDBACK_TOKEN?: string;
};

type Vars = { sub: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// One JWKS fetcher per isolate; jose caches keys and re-fetches on rotation.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const getJwks = (clientId: string) => {
  jwks ??= createRemoteJWKSet(
    new URL(`https://api.workos.com/sso/jwks/${clientId}`),
  );
  return jwks;
};

const LIMITS = {
  title: 200,
  url: 2048,
  note: 2000,
  appId: 100,
  linksPerUser: 500,
};

app.get("/healthz", (c) => c.json({ ok: true, service: "outfitter-api" }));

// --- feedback -> GitHub issue (no sign-in required) ---
// Deliberately OUTSIDE the /v1/* auth wall: desktop/web users without a
// GitHub account (or an Outfitter account) can still report bugs. Spam
// defenses: a honeypot field, size caps, and Cloudflare's edge on top.
const FEEDBACK_LABEL: Record<string, string> = {
  bug: "bug",
  feature: "enhancement",
  question: "question",
};
const FEEDBACK_REPO = "TylerSander/outfitter";

/** Neutralize GitHub-flavored markdown that would notify/act on submit:
 *  a zero-width space after "@" defuses @mention pings, and after "#" before
 *  a digit defuses issue/PR autolinks and closing keywords (closes #12).
 *  Preserves readability — the text still reads the same. */
function neutralizeGithub(text: string): string {
  const zwsp = String.fromCharCode(0x200b);
  return text.replace(/@(?=\w)/g, `@${zwsp}`).replace(/#(?=\d)/g, `#${zwsp}`);
}

app.post("/feedback", async (c) => {
  if (!c.env.GITHUB_FEEDBACK_TOKEN) {
    return c.json({ error: "feedback relay not configured" }, 501);
  }
  let body: {
    type?: unknown;
    title?: unknown;
    body?: unknown;
    meta?: unknown;
    website?: unknown; // honeypot: real clients never fill this
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  if (typeof body.website === "string" && body.website !== "") {
    return c.body(null, 204); // pretend success to bots
  }
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so "toString",
  // "constructor", etc. would pass as valid types.
  const type =
    typeof body.type === "string" && Object.hasOwn(FEEDBACK_LABEL, body.type)
      ? body.type
      : null;
  const title = typeof body.title === "string" ? neutralizeGithub(body.title.trim()).slice(0, 120) : "";
  const detail = typeof body.body === "string" ? neutralizeGithub(body.body.trim()).slice(0, 8000) : "";
  if (type === null || title === "" || detail === "") {
    return c.json({ error: "type (bug|feature|question), title, and body are required" }, 400);
  }

  // Optional attribution: if the caller sent an Outfitter session token and it
  // verifies, note the user id. Invalid tokens don't block feedback.
  let attribution = "_Submitted anonymously via the Outfitter feedback relay._";
  const header = c.req.header("Authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    try {
      const { payload } = await jwtVerify(header.slice(7), getJwks(c.env.WORKOS_CLIENT_ID), {
        issuer: c.env.WORKOS_ISSUER,
        clockTolerance: 30,
      });
      if (typeof payload.sub === "string") {
        attribution = `_Submitted via the Outfitter feedback relay by account \`${payload.sub}\`._`;
      }
    } catch {
      // anonymous is fine
    }
  }

  const meta =
    typeof body.meta === "string" && body.meta.trim() !== ""
      ? `\n\n### Diagnostics\n\`\`\`\n${body.meta.trim().slice(0, 2000)}\n\`\`\``
      : "";
  const res = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.GITHUB_FEEDBACK_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "outfitter-feedback-relay",
    },
    body: JSON.stringify({
      title: `[${type}] ${title}`,
      body: `${detail}${meta}\n\n${attribution}`,
      labels: [FEEDBACK_LABEL[type]],
    }),
  });
  if (!res.ok) {
    return c.json({ error: `GitHub rejected the issue (HTTP ${res.status})` }, 502);
  }
  const issue = (await res.json()) as { html_url?: string };
  return c.json({ url: issue.html_url ?? null }, 201);
});

// --- auth middleware ---
app.use("/v1/*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(c.env.WORKOS_CLIENT_ID), {
      issuer: c.env.WORKOS_ISSUER,
      clockTolerance: 30,
    }));
  } catch {
    return c.json({ error: "invalid or expired token" }, 401);
  }
  if (typeof payload.sub !== "string" || payload.sub === "") {
    return c.json({ error: "token has no subject" }, 401);
  }
  c.set("sub", payload.sub);
  await c.env.DB.prepare(
    "INSERT INTO users (sub) VALUES (?) ON CONFLICT(sub) DO NOTHING",
  )
    .bind(payload.sub)
    .run();
  await next();
});

const logEvent = (
  db: D1Database,
  sub: string,
  action: string,
  meta: unknown,
) =>
  db
    .prepare("INSERT INTO events (user_sub, action, meta) VALUES (?, ?, ?)")
    .bind(sub, action, JSON.stringify(meta))
    .run();

// --- account ---
app.get("/v1/me", async (c) => {
  const sub = c.get("sub");
  const user = await c.env.DB.prepare(
    "SELECT sub, email, is_admin, first_seen_at FROM users WHERE sub = ?",
  )
    .bind(sub)
    .first();
  const linkCount = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM links WHERE user_sub = ?",
  )
    .bind(sub)
    .first<{ n: number }>();
  return c.json({ user, linkCount: linkCount?.n ?? 0 });
});

app.get("/v1/events", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT action, meta, created_at FROM events WHERE user_sub = ? ORDER BY id DESC LIMIT 50",
  )
    .bind(c.get("sub"))
    .all();
  return c.json({ events: results });
});

// --- saved links / apps ---
app.get("/v1/links", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, kind, url, title, note, app_id, created_at, updated_at FROM links WHERE user_sub = ? ORDER BY created_at DESC, id",
  )
    .bind(c.get("sub"))
    .all();
  return c.json({ links: results });
});

type LinkBody = {
  kind?: unknown;
  url?: unknown;
  title?: unknown;
  note?: unknown;
  appId?: unknown;
};

function validateLink(body: LinkBody): { error: string } | {
  kind: "link" | "app";
  url: string | null;
  title: string;
  note: string | null;
  appId: string | null;
} {
  const kind = body.kind === "app" ? "app" : body.kind === "link" ? "link" : null;
  if (kind === null) return { error: "kind must be 'link' or 'app'" };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "" || title.length > LIMITS.title) {
    return { error: `title required, at most ${LIMITS.title} chars` };
  }
  let url: string | null = null;
  if (body.url !== undefined && body.url !== null) {
    if (typeof body.url !== "string" || body.url.length > LIMITS.url) {
      return { error: "url must be a string" };
    }
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { error: "url must be http(s)" };
      }
      url = body.url;
    } catch {
      return { error: "url is not a valid URL" };
    }
  }
  const note =
    typeof body.note === "string" && body.note.trim() !== ""
      ? body.note.slice(0, LIMITS.note)
      : null;
  const appId =
    typeof body.appId === "string" && /^[a-z0-9-]{1,100}$/.test(body.appId)
      ? body.appId
      : null;
  if (kind === "link" && url === null) return { error: "links need a url" };
  if (kind === "app" && appId === null) {
    return { error: "apps need an appId (catalog id, kebab-case)" };
  }
  return { kind, url, title, note, appId };
}

app.post("/v1/links", async (c) => {
  const sub = c.get("sub");
  let body: LinkBody;
  try {
    body = await c.req.json<LinkBody>();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  const parsed = validateLink(body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  // Atomic cap: the INSERT itself only fires while the user is under the
  // limit, so two concurrent POSTs can't both slip past a separate count.
  const id = crypto.randomUUID();
  const result = await c.env.DB.prepare(
    "INSERT INTO links (id, user_sub, kind, url, title, note, app_id) " +
      "SELECT ?, ?, ?, ?, ?, ?, ? " +
      "WHERE (SELECT COUNT(*) FROM links WHERE user_sub = ?) < ?",
  )
    .bind(
      id,
      sub,
      parsed.kind,
      parsed.url,
      parsed.title,
      parsed.note,
      parsed.appId,
      sub,
      LIMITS.linksPerUser,
    )
    .run();
  if (result.meta.changes === 0) {
    return c.json({ error: `limit of ${LIMITS.linksPerUser} saved items reached` }, 409);
  }
  await logEvent(c.env.DB, sub, "link.created", { id, kind: parsed.kind, title: parsed.title });
  return c.json({ id }, 201);
});

app.patch("/v1/links/:id", async (c) => {
  const sub = c.get("sub");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(
    "SELECT kind, url, title, note, app_id FROM links WHERE id = ? AND user_sub = ?",
  )
    .bind(id, sub)
    .first<{ kind: string; url: string | null; title: string; note: string | null; app_id: string | null }>();
  if (!existing) return c.json({ error: "not found" }, 404);

  let body: LinkBody;
  try {
    body = await c.req.json<LinkBody>();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  // Merge patch over existing, then re-validate the whole record.
  const parsed = validateLink({
    kind: body.kind ?? existing.kind,
    url: body.url ?? existing.url,
    title: body.title ?? existing.title,
    note: body.note ?? existing.note,
    appId: body.appId ?? existing.app_id,
  });
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  await c.env.DB.prepare(
    "UPDATE links SET kind = ?, url = ?, title = ?, note = ?, app_id = ?, updated_at = datetime('now') WHERE id = ? AND user_sub = ?",
  )
    .bind(parsed.kind, parsed.url, parsed.title, parsed.note, parsed.appId, id, sub)
    .run();
  await logEvent(c.env.DB, sub, "link.updated", { id });
  return c.json({ ok: true });
});

app.delete("/v1/links/:id", async (c) => {
  const sub = c.get("sub");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "DELETE FROM links WHERE id = ? AND user_sub = ?",
  )
    .bind(id, sub)
    .run();
  if (result.meta.changes === 0) return c.json({ error: "not found" }, 404);
  await logEvent(c.env.DB, sub, "link.deleted", { id });
  return c.json({ ok: true });
});

export default app;
