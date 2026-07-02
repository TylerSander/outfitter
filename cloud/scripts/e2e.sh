#!/usr/bin/env bash
# End-to-end test of the accounts API against REAL WorkOS (sandbox environment).
# Creates (or reuses) a test user, gets a genuine AuthKit access token via the
# password grant, and exercises the Worker running on localhost:8787.
# Requires: wrangler dev --local already running, and WORKOS_API_KEY /
# WORKOS_CLIENT_ID in the environment (source ~/.config/outfitter/workos.env).
set -euo pipefail

API=${API:-http://127.0.0.1:8787}
EMAIL="e2e-test@outfitter.invalid"
PASSWORD="E2e-test-password-$(date +%Y%m)"

say() { printf '\n== %s\n' "$*"; }

say "ensure test user exists"
CREATE=$(curl -s -X POST https://api.workos.com/user_management/users \
  -H "Authorization: Bearer $WORKOS_API_KEY" -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\", \"email_verified\": true}")
USER_ID=$(echo "$CREATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id",""))')
if [ -z "$USER_ID" ]; then
  # Already exists (or password drifted month-over-month): find and reset password.
  USER_ID=$(curl -s "https://api.workos.com/user_management/users?email=$EMAIL" \
    -H "Authorization: Bearer $WORKOS_API_KEY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')
  curl -s -X PUT "https://api.workos.com/user_management/users/$USER_ID" \
    -H "Authorization: Bearer $WORKOS_API_KEY" -H "Content-Type: application/json" \
    -d "{\"password\": \"$PASSWORD\"}" > /dev/null
fi
echo "user: $USER_ID"

say "authenticate (password grant) for a real access token"
TOKEN=$(curl -s -X POST https://api.workos.com/user_management/authenticate \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\": \"password\", \"client_id\": \"$WORKOS_CLIENT_ID\", \"client_secret\": \"$WORKOS_API_KEY\", \"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token") or sys.exit("no access_token: "+json.dumps(d)))')
echo "token acquired (${#TOKEN} chars)"

fail() { echo "FAIL: $1"; exit 1; }
check() { # check <desc> <expected-status> <actual-status>
  [ "$3" = "$2" ] && echo "ok: $1 ($3)" || fail "$1 expected $2 got $3"
}

say "unauthenticated request is rejected"
check "GET /v1/links no token" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/links")"
check "GET /v1/links bad token" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer not.a.jwt' "$API/v1/links")"

AUTH="Authorization: Bearer $TOKEN"

say "me + empty list"
check "GET /v1/me" 200 "$(curl -s -o /tmp/me.json -w '%{http_code}' -H "$AUTH" "$API/v1/me")"
cat /tmp/me.json; echo

say "create link + app"
LINK_ID=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"kind":"link","url":"https://tylersander.me","title":"My site","note":"personal homepage"}' \
  "$API/v1/links" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "link: $LINK_ID"
APP_ID=$(curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"kind":"app","appId":"obs-studio","title":"OBS Studio"}' \
  "$API/v1/links" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "app: $APP_ID"

say "validation rejects garbage"
check "link w/o url" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"kind":"link","title":"nope"}' "$API/v1/links")"
check "bad kind" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"kind":"virus","title":"x"}' "$API/v1/links")"
check "javascript: url" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{"kind":"link","url":"javascript:alert(1)","title":"x"}' "$API/v1/links")"

say "list shows both, update works, delete works"
N=$(curl -s -H "$AUTH" "$API/v1/links" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["links"]))')
[ "$N" -ge 2 ] || fail "expected >=2 links, got $N"
echo "ok: list has $N items"
check "PATCH title" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d '{"title":"My site (updated)"}' "$API/v1/links/$LINK_ID")"
check "DELETE" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$AUTH" "$API/v1/links/$LINK_ID")"
check "DELETE again -> 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$AUTH" "$API/v1/links/$LINK_ID")"
check "PATCH foreign id -> 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d '{"title":"x"}' "$API/v1/links/00000000-0000-0000-0000-000000000000")"

say "events recorded"
curl -s -H "$AUTH" "$API/v1/events" | python3 -c 'import json,sys; evs=json.load(sys.stdin)["events"]; print("events:", [e["action"] for e in evs][:6]); assert any(e["action"]=="link.created" for e in evs)'

say "ALL E2E CHECKS PASSED"
