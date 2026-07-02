/* ============================================================
   OUTFITTER SITE — shared runtime for all pages (ES module).
   Auth is WorkOS AuthKit via the official @workos-inc/authkit-js
   SDK (self-hosted pinned bundle in vendor/authkit.js — regenerate
   with `pnpm bundle:authkit`). Sign-in/sign-up happen on WorkOS's
   hosted auth page; the SDK handles PKCE, the ?code= callback,
   session refresh, and a real sign-out of the hosted session.
   Also here: nav signed-in indicator, downloads/release views
   (GitHub Releases API, rendered on-site), and footer links.
   ============================================================ */
import { createClient } from "./vendor/authkit.js";

const REPO = "TylerSander/outfitter";
// Paste the Discord invite URL here once the server exists; until then the
// footer shows "Discord — soon" as a disabled link on every page.
const DISCORD_INVITE = "";

const WORKOS_CLIENT_ID = "client_01KWGH1817P2XJQY5D2ANQZCJ7";
// The directory root is what's registered as the redirect URI in WorkOS,
// so the callback always lands on index.html and gets forwarded to Account.
const REDIRECT_URI = new URL(".", location.href).href;
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

/* ---------- auth (WorkOS AuthKit SDK) ---------- */
let authkit = null;

async function initAuth(hadCode) {
  try {
    authkit = await createClient(WORKOS_CLIENT_ID, {
      redirectUri: REDIRECT_URI,
      // Runs after the SDK finishes the code exchange on the callback page.
      onRedirectCallback: () => {
        if (!/account\.html$/.test(location.pathname)) location.replace("account.html");
        else { renderNavState(); renderAccount(); }
      },
    });
  } catch (e) {
    authkit = null;
    if (hadCode) sessionStorage.setItem(AUTH_ERR_KEY, "Sign-in could not be completed — please try again.");
  }
  // A callback that produced no user means the exchange failed silently.
  if (hadCode && authkit && !authkit.getUser() && !/account\.html$/.test(location.pathname)) {
    sessionStorage.setItem(AUTH_ERR_KEY, "Sign-in could not be completed — please try again.");
    location.replace("account.html");
  }
}

const currentUser = () => (authkit ? authkit.getUser() : null);

/* ---------- nav: signed-in indicator on the Account link ---------- */
function renderNavState() {
  const dot = byId("nav-dot");
  if (!dot) return;
  const u = currentUser();
  dot.classList.toggle("on", !!u);
  dot.title = u ? `Signed in as ${u.email || "your account"}` : "Not signed in";
  const link = dot.closest("a");
  if (link) link.setAttribute("aria-label", dot.title);
}

/* ---------- account page ---------- */
function renderAccount() {
  const controls = byId("acct-controls");
  if (!controls) return;
  const u = currentUser();
  if (u) {
    controls.innerHTML = `<p class="signed">✓ logged in as ${esc(u.email || "your account")}</p>
      <p style="font-family:var(--serif);font-style:italic;font-size:12.5px;color:var(--mute)">
      Use the same email inside the Outfitter app.</p>
      <button class="btn" id="signout">Log out</button>`;
    byId("signout").onclick = () =>
      authkit.signOut({ returnTo: new URL("account.html", REDIRECT_URI).href });
  } else if (authkit) {
    controls.innerHTML = `<button class="btn" id="signin">Log in</button>
      <p style="font-family:var(--serif);font-style:italic;font-size:12.5px;color:var(--mute);margin-top:16px">
      No account yet? Create one right on the login page.</p>`;
    byId("signin").onclick = () => authkit.signIn();
  } else {
    controls.innerHTML = `<p class="err">Sign-in is temporarily unavailable — please refresh in a minute.</p>`;
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
  // Old one-page anchors still arrive from external links — forward them.
  if (/(^|\/)(index\.html)?$/.test(location.pathname)) {
    const map = { "#about": "about.html", "#downloads": "downloads.html", "#account": "account.html", "#feedback": "about.html" };
    if (map[location.hash]) { location.replace(map[location.hash]); return; }
  }

  // Leftovers from the pre-SDK hand-rolled auth.
  localStorage.removeItem("outfitter.session");
  sessionStorage.removeItem("pkce_verifier");
  sessionStorage.removeItem("pkce_state");

  // Non-auth features never wait on WorkOS.
  applyDiscordLink();
  if (byId("dl-grid")) loadDownloads();
  if (byId("home-version")) loadHomeVersion();

  const hadCode = new URLSearchParams(location.search).has("code");
  await initAuth(hadCode);
  renderNavState();
  renderAccount();

  // Handy for debugging from the console; holds no secrets.
  window.outfitterAuth = authkit;
})();
