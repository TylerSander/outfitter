# Outfitter accounts API (`cloud/`)

Cloudflare Worker backing Outfitter user accounts: sign in with WorkOS AuthKit,
save links and catalog apps for later, synced across devices.

## Architecture

- **Auth:** hosted [AuthKit](https://workos.com/docs/authkit). The desktop app
  runs an OAuth **PKCE public-client** flow (system browser + `127.0.0.1`
  loopback redirect — allowed even in WorkOS production environments per
  RFC 8252). This Worker is a pure **resource server**: it verifies AuthKit
  access-token JWTs against `https://api.workos.com/sso/jwks/<client_id>`
  (issuer + expiry + signature; AuthKit JWTs have **no `aud` claim** by
  default) and holds **no WorkOS secret**.
- **Data:** D1 (SQLite). All rows keyed by the JWT `sub` (WorkOS user id).
  See `schema.sql`. Users are standalone consumers (no WorkOS organizations),
  so WorkOS role claims don't apply — authorization is row ownership plus a
  local `is_admin` flag.
- **Audit-lite:** an append-only `events` table records link activity per
  user (WorkOS Audit Logs is org-scoped/enterprise and doesn't fit consumer
  users — see "Catalog Decisions"/"WorkOS Integration" notes in the vault).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness (no auth) |
| GET | `/v1/me` | account info + link count |
| GET | `/v1/links` | list saved items |
| POST | `/v1/links` | save `{kind: "link", url, title}` or `{kind: "app", appId, title}` |
| PATCH | `/v1/links/:id` | update fields |
| DELETE | `/v1/links/:id` | remove |
| GET | `/v1/events` | own recent activity |

All `/v1/*` routes need `Authorization: Bearer <AuthKit access token>`.

## Dev loop

```bash
pnpm install
pnpm db:local        # apply schema.sql to the local D1
pnpm dev             # wrangler dev --local on :8787
```

End-to-end test against real WorkOS (creates a sandbox user, gets a real
token via the password grant, exercises CRUD): `./scripts/e2e.sh` (needs
`~/.config/outfitter/workos.env` on the dev server).

## Deploy (pending Cloudflare API token)

Target: `api.outfitter.tylersander.me` (zone `tylersander.me`). Needs a
Cloudflare API token with Workers Scripts:Edit, D1:Edit, and zone DNS:Edit.
Then: create the D1 database (`wrangler d1 create outfitter`), paste its id
into `wrangler.toml`, apply `pnpm db:remote`, uncomment the route, and
`pnpm deploy`. Set `CLOUDFLARE_API_TOKEN` in the environment for wrangler.

## Not yet built

- Deep-link/loopback sign-in flow in the desktop app (Rust core) + Account UI.
- WorkOS auth-event webhook ingestion (needs the webhook secret from the
  dashboard).
- MCP endpoint exposing saved apps (AuthKit as OAuth AS; CIMD + resource
  indicator; `/.well-known/oauth-protected-resource`; design in vault note).
