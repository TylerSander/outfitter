/* ============================================================
   OUTFITTER SITE — shared runtime for all pages.
   Handles: WorkOS AuthKit sign-in (PKCE public client), the
   signed-in indicator in the nav, the downloads/release views
   (GitHub Releases API, rendered on-site), and footer links.
   ============================================================ */

const REPO = "TylerSander/outfitter";
// Paste the Discord invite URL here once the server exists; until then the
// footer shows "Discord — soon" as a disabled link on every page.
const DISCORD_INVITE = "";

const WORKOS_CLIENT_ID = "client_01KWGH1817P2XJQY5D2ANQZCJ7";
const AUTH_BASE = "https://api.workos.com/user_management";
// The directory root is what's registered as the redirect URI in WorkOS,
// so the callback always lands on index.html and gets forwarded to Account.
const REDIRECT_URI = new URL(".", location.href).href;
const SESSION_KEY = "outfitter.session";
const AUTH_ERR_KEY = "outfitter.authError";

const byId = (id) => document.getElementById(id);

/* ---------- safety helpers ---------- */
// Escape anything from the network before it touches innerHTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only ever link to GitHub's own release/API hosts.
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    const ok = /(^|\.)github\.com$/.test(url.hostname) || /(^|\.)githubusercontent\.com$/.test(url.hostname);
    return url.protocol === "https:" && ok ? url.href : "#";
  } catch { return "#"; }
};

/* ---------- session ---------- */
function readSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(SESSION_KEY); // corrupt value shouldn't brick the UI
    return null;
  }
}

/* ---------- WorkOS AuthKit, PKCE public client ---------- */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function startAuth(screenHint) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  sessionStorage.setItem("pkce_verifier", verifier);
  // CSRF defense: a random state echoed back and verified on the callback.
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
  sessionStorage.setItem("pkce_state", state);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const p = new URLSearchParams({
    response_type: "code",
    client_id: WORKOS_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    provider: "authkit",
    screen_hint: screenHint,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  location.assign(`${AUTH_BASE}/authorize?${p}`);
}

async function finishAuth(code) {
  const verifier = sessionStorage.getItem("pkce_verifier");
  if (!verifier) return;
  sessionStorage.removeItem("pkce_verifier");
  const res = await fetch(`${AUTH_BASE}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: WORKOS_CLIENT_ID,
      code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`sign-in exchange failed (${res.status})`);
  const data = await res.json();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    email: data.user && data.user.email,
    userId: data.user && data.user.id,
    at: Date.now(),
  }));
}

/* ---------- nav: signed-in indicator on the Account link ---------- */
function renderNavState() {
  const dot = byId("nav-dot");
  if (!dot) return;
  const s = readSession();
  dot.classList.toggle("on", !!s);
  dot.title = s ? `Signed in as ${s.email || "your account"}` : "Not signed in";
  const link = dot.closest("a");
  if (link) link.setAttribute("aria-label", dot.title);
}

/* ---------- account page ---------- */
function renderAccount() {
  const controls = byId("acct-controls");
  if (!controls) return;
  const s = readSession();
  if (s) {
    controls.innerHTML = `<p class="signed">✓ signed in as ${esc(s.email || s.userId || "your account")}</p>
      <p style="font-family:var(--serif);font-style:italic;font-size:12.5px;color:var(--mute)">
      Your account is ready — sign in with the same email inside the Outfitter app.</p>
      <button class="btn quiet" id="signout">Sign out</button>`;
    byId("signout").onclick = () => {
      localStorage.removeItem(SESSION_KEY);
      renderAccount();
      renderNavState();
    };
  } else {
    controls.innerHTML = `<button class="btn" id="signup">Create account</button>
      <button class="btn quiet" id="signin" style="margin-left:26px">Sign in</button>`;
    byId("signup").onclick = () => startAuth("sign-up");
    byId("signin").onclick = () => startAuth("sign-in");
  }
  const err = sessionStorage.getItem(AUTH_ERR_KEY);
  if (err) {
    sessionStorage.removeItem(AUTH_ERR_KEY);
    controls.insertAdjacentHTML("beforeend", `<p class="err">${esc(err)}</p>`);
  }
}

/* ---------- downloads: straight from GitHub Releases, rendered on-site ---------- */
const OS_DEFS = [
  { key: "windows", name: "Windows", test: /windows/i,
    assets: [[/x64-setup\.exe$/, "Installer", "recommended"], [/x64_en-US\.msi$/, "MSI", "managed installs"]] },
  { key: "mac", name: "macOS", test: /mac/i,
    assets: [[/aarch64\.dmg$/, "Apple Silicon", "M1–M4"], [/x64\.dmg$/, "Intel", ""]] },
  { key: "linux", name: "Linux", test: /linux|x11|wayland/i,
    assets: [[/\.AppImage$/, "AppImage", "any distro"], [/amd64\.deb$/, ".deb", "Debian/Ubuntu"], [/x86_64\.rpm$/, ".rpm", "Fedora"]] },
];

function visitorOS() {
  const ua = navigator.userAgent;
  // Mobile visitors get no highlighted column — Outfitter is desktop-only.
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return null;
  for (const os of OS_DEFS) if (os.test.test(ua)) return os.key;
  return null;
}

// Minimal markdown for release-note bodies: headings, bullets, bold, code,
// links (GitHub hosts only). Everything is escaped before any tag is added.
function mdInline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, text, url) => {
      const u = safeUrl(url.replace(/&amp;/g, "&"));
      return u === "#" ? text : `<a href="${u}">${text}</a>`;
    });
}
function mdLite(md) {
  const lines = esc(md || "").split(/\r?\n/);
  let html = "", inList = false, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${para.join(" ")}</p>`; para = []; } };
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); closeList(); continue; }
    if (/^-{3,}$/.test(line)) { flushPara(); closeList(); continue; } // horizontal rule → section break
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { flushPara(); closeList(); html += `<h4>${mdInline(h[1])}</h4>`; continue; }
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { flushPara(); if (!inList) { html += "<ul>"; inList = true; } html += `<li>${mdInline(li[1])}</li>`; continue; }
    para.push(mdInline(line));
  }
  flushPara(); closeList();
  return html;
}

function assetLinks(rel) {
  return OS_DEFS.map((os) =>
    os.assets.map(([re, label]) => {
      const a = (rel.assets || []).find((x) => re.test(x.name));
      return a ? `<a href="${safeUrl(a.browser_download_url)}">${os.name} ${label} ↓</a>` : "";
    }).join("")
  ).join("");
}

async function loadDownloads() {
  const meta = byId("dl-meta");
  const grid = byId("dl-grid");
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const releases = (await res.json()).filter((r) => !r.draft && !r.prerelease);
    if (!releases.length) throw new Error("no published releases");
    const rel = releases[0];
    const date = esc((rel.published_at || "").slice(0, 10));
    meta.innerHTML = `Latest release <b>${esc(rel.tag_name)}</b> · ${date} · existing installs update themselves`;
    const mine = visitorOS();
    grid.innerHTML = OS_DEFS.map((os) => {
      const links = os.assets.map(([re, label, sub]) => {
        const a = rel.assets.find((x) => re.test(x.name));
        if (!a) return "";
        const mb = (a.size / 1048576).toFixed(1);
        return `<a href="${safeUrl(a.browser_download_url)}">${label} ↓<span class="sub">${sub ? sub + " · " : ""}${mb} MB</span></a>`;
      }).join("");
      const yours = os.key === mine;
      return `<section class="${yours ? "yours" : ""}"><h3>${os.name}${yours ? '<span class="you">YOUR OS</span>' : ""}</h3>${links}</section>`;
    }).join("");
    const notes = byId("notes-body");
    if (notes) notes.innerHTML = mdLite(rel.body) || "<p>No notes for this release.</p>";
    const prev = byId("prev");
    if (prev) {
      const older = releases.slice(1);
      prev.innerHTML = older.length
        ? older.map((r) => `<details class="rel"><summary>${esc(r.tag_name)}<span class="sub">${esc((r.published_at || "").slice(0, 10))}</span></summary><div class="body">${assetLinks(r)}<div class="notes-md">${mdLite(r.body)}</div></div></details>`).join("")
        : `<p class="notes-md">No earlier versions yet.</p>`;
    }
  } catch (e) {
    meta.innerHTML = `<span class="err">Couldn't reach GitHub for release data — try again in a minute, or grab it from the <a href="https://github.com/${REPO}/releases/latest">releases page ↗</a>.</span>`;
  }
}

/* ---------- home: current-version line under the hero ---------- */
async function loadHomeVersion() {
  const el = byId("home-version");
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return;
    const rel = await res.json();
    el.innerHTML = `Current version <b>${esc(rel.tag_name)}</b> · Windows / macOS / Linux · <a href="downloads.html" style="border:none">get it ↓</a>`;
  } catch { /* the line just stays empty */ }
}

/* ---------- footer: Discord link (placeholder until the server exists) ---------- */
function applyDiscordLink() {
  const el = byId("discord-link");
  if (!el) return;
  if (DISCORD_INVITE) {
    el.href = DISCORD_INVITE;
  } else {
    el.removeAttribute("href");
    el.textContent = "Discord — soon";
    el.classList.add("soon");
    el.title = "The Outfitter Discord is being set up";
  }
}

/* ---------- boot ---------- */
(async () => {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code) {
    // WorkOS redirects to the site root; finish the exchange here, then
    // land the visitor on the Account page whichever page this is.
    const expected = sessionStorage.getItem("pkce_state");
    sessionStorage.removeItem("pkce_state");
    if (!expected || params.get("state") !== expected) {
      sessionStorage.setItem(AUTH_ERR_KEY, "Sign-in could not be verified (state mismatch) — please try again.");
    } else {
      try {
        await finishAuth(code);
      } catch (e) {
        sessionStorage.setItem(AUTH_ERR_KEY, `${e.message} — try again.`);
      }
    }
    history.replaceState(null, "", location.pathname);
    if (!/account\.html$/.test(location.pathname)) { location.replace("account.html"); return; }
  }
  // Old one-page anchors still arrive from external links — forward them.
  if (/(^|\/)(index\.html)?$/.test(location.pathname)) {
    const map = { "#about": "about.html", "#downloads": "downloads.html", "#account": "account.html", "#feedback": "about.html" };
    if (map[location.hash]) { location.replace(map[location.hash]); return; }
  }
  renderNavState();
  applyDiscordLink();
  renderAccount();
  if (byId("dl-grid")) loadDownloads();
  if (byId("home-version")) loadHomeVersion();
})();
