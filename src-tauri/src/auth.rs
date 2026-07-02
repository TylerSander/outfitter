//! WorkOS AuthKit sign-in for the desktop app.
//!
//! Follows WorkOS's native-app pattern (and Outfitter's Architecture Plan):
//! a PKCE public client (the client id ships in the app; there is NO secret),
//! the hosted AuthKit page opened in the SYSTEM browser, and the OAuth code
//! delivered back over a 127.0.0.1 loopback listener (RFC 8252). The refresh
//! token is stored in the OS keychain (Windows Credential Manager / macOS
//! Keychain / Linux Secret Service) via the `keyring` crate; the short-lived
//! access token is handed to the frontend and kept only in memory.
//!
//! Account CREATION happens on the website — the app only signs existing
//! users in. Empirically verified earlier: AuthKit's token issuer is
//! `https://api.workos.com/user_management/<client_id>` and its access tokens
//! carry no `aud` claim (see the vault's WorkOS Integration note).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CLIENT_ID: &str = "client_01KWGH1817P2XJQY5D2ANQZCJ7";
const AUTH_BASE: &str = "https://api.workos.com/user_management";
const KEYRING_SERVICE: &str = "app.outfitter.desktop";
const KEYRING_ACCOUNT: &str = "workos-refresh-token";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub profile_picture_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user: UserProfile,
    pub access_token: String,
}

// Shape of the WorkOS /authenticate response (snake_case on the wire).
#[derive(Deserialize)]
struct AuthResponse {
    user: WosUser,
    access_token: String,
    refresh_token: String,
}

#[derive(Deserialize)]
struct WosUser {
    id: String,
    email: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    profile_picture_url: Option<String>,
}

impl From<WosUser> for UserProfile {
    fn from(u: WosUser) -> Self {
        Self {
            id: u.id,
            email: u.email,
            first_name: u.first_name,
            last_name: u.last_name,
            profile_picture_url: u.profile_picture_url,
        }
    }
}

// ---- PKCE helpers ----------------------------------------------------------

fn b64url(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64url(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| format!("randomness unavailable: {e}"))?;
    Ok(b64url(&buf))
}

fn challenge_for(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    b64url(&hasher.finalize())
}

// ---- loopback callback capture --------------------------------------------

struct Callback {
    code: String,
}

/// Accept HTTP connections on `listener` until one arrives at
/// `/oauth/callback` carrying the expected `state`, then return its `code`.
/// Every request gets a small HTML reply. Times out after CALLBACK_TIMEOUT.
fn await_callback(listener: &TcpListener, expected_state: &str) -> Result<Callback, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("callback server error: {e}"))?;
    let deadline = Instant::now() + CALLBACK_TIMEOUT;

    loop {
        if Instant::now() >= deadline {
            return Err("Sign-in timed out. Please try again.".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");

                if let Some(query) = path.strip_prefix("/oauth/callback?") {
                    let params = parse_query(query);
                    // The user may have hit Cancel on the hosted page.
                    if let Some(err) = params.get("error") {
                        respond(&mut stream, RESULT_HTML_ERROR);
                        return Err(format!("Sign-in was cancelled or failed ({err})."));
                    }
                    let state = params.get("state").map(String::as_str).unwrap_or("");
                    let code = params.get("code").cloned();
                    // Constant-ish comparison; state is our own random token.
                    if state != expected_state {
                        respond(&mut stream, RESULT_HTML_ERROR);
                        return Err("Sign-in could not be verified (state mismatch).".to_string());
                    }
                    match code {
                        Some(code) if !code.is_empty() => {
                            respond(&mut stream, RESULT_HTML_OK);
                            return Ok(Callback { code });
                        }
                        _ => {
                            respond(&mut stream, RESULT_HTML_ERROR);
                            return Err("Sign-in response was missing its code.".to_string());
                        }
                    }
                }
                // Anything else (favicon, etc.): 404 and keep waiting.
                respond(&mut stream, RESULT_HTML_404);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("callback server error: {e}")),
        }
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            Some((k.to_string(), url_decode(v)))
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let bytes = s.replace('+', " ");
    let bytes = bytes.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&format!("{}{}", bytes[i + 1] as char, bytes[i + 2] as char), 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(stream: &mut std::net::TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

const RESULT_HTML_OK: &str = "<!doctype html><meta charset=utf-8><title>Outfitter</title><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0a10;color:#ece6d9;font-family:system-ui,sans-serif\"><div style=\"text-align:center\"><div style=\"font-size:13px;letter-spacing:5px;text-transform:uppercase;color:#e8b04b\">Outfitter</div><p style=\"color:#8f8899;font-style:italic\">You're signed in. You can close this tab and return to the app.</p></div></body>";
const RESULT_HTML_ERROR: &str = "<!doctype html><meta charset=utf-8><title>Outfitter</title><body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0a10;color:#ece6d9;font-family:system-ui,sans-serif\"><div style=\"text-align:center\"><div style=\"font-size:13px;letter-spacing:5px;text-transform:uppercase;color:#ff8577\">Outfitter</div><p style=\"color:#8f8899;font-style:italic\">Sign-in didn't complete. You can close this tab and try again in the app.</p></div></body>";
const RESULT_HTML_404: &str = "<!doctype html><title>Not found</title>";

// ---- token exchange (ureq; pure-Rust TLS) ----------------------------------

fn exchange(body: serde_json::Value) -> Result<AuthResponse, String> {
    let resp = ureq::post(&format!("{AUTH_BASE}/authenticate")).send_json(body);
    match resp {
        Ok(r) => r
            .into_json::<AuthResponse>()
            .map_err(|e| format!("couldn't read the sign-in response: {e}")),
        Err(ureq::Error::Status(401 | 403, _)) => {
            Err("Sign-in was rejected. Please try again.".to_string())
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("Sign-in failed (HTTP {code}).")),
        Err(e) => Err(format!("Couldn't reach the sign-in service: {e}")),
    }
}

fn store_refresh(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.set_password(token))
        .map_err(|e| format!("couldn't save your session securely: {e}"))
}

fn read_refresh() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()?
        .get_password()
        .ok()
}

fn clear_refresh() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
}

// ---- commands --------------------------------------------------------------

/// Full interactive sign-in. Blocks (run under spawn_blocking) while the user
/// completes the hosted flow in their browser.
pub fn login_blocking(app: &tauri::AppHandle) -> Result<Session, String> {
    use tauri_plugin_opener::OpenerExt;

    let verifier = random_b64url(48)?;
    let challenge = challenge_for(&verifier);
    let state = random_b64url(16)?;

    // Bind first so we know the port before building the redirect URI.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("couldn't open a local sign-in port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("couldn't read the local sign-in port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

    let authorize_url = format!(
        "{AUTH_BASE}/authorize?response_type=code&client_id={CLIENT_ID}\
         &redirect_uri={redirect}&provider=authkit&screen_hint=sign-in\
         &state={state}&code_challenge={challenge}&code_challenge_method=S256",
        redirect = urlencode(&redirect_uri),
        state = urlencode(&state),
        challenge = urlencode(&challenge),
    );

    app.opener()
        .open_url(authorize_url, None::<&str>)
        .map_err(|e| format!("couldn't open your browser for sign-in: {e}"))?;

    let callback = await_callback(&listener, &state)?;

    let auth = exchange(serde_json::json!({
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": callback.code,
        "code_verifier": verifier,
    }))?;

    store_refresh(&auth.refresh_token)?;
    Ok(Session {
        user: auth.user.into(),
        access_token: auth.access_token,
    })
}

/// Silent re-auth using the stored refresh token. `Ok(None)` = not signed in.
pub fn restore_blocking() -> Result<Option<Session>, String> {
    let Some(refresh) = read_refresh() else {
        return Ok(None);
    };
    match exchange(serde_json::json!({
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "refresh_token": refresh,
    })) {
        Ok(auth) => {
            // Refresh tokens rotate on use — persist the new one.
            store_refresh(&auth.refresh_token)?;
            Ok(Some(Session {
                user: auth.user.into(),
                access_token: auth.access_token,
            }))
        }
        // A rejected/expired refresh token means "signed out", not an error.
        Err(_) => {
            clear_refresh();
            Ok(None)
        }
    }
}

pub fn logout() {
    clear_refresh();
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // The canonical RFC 7636 Appendix B vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(challenge_for(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn url_decodes_callback_values() {
        assert_eq!(url_decode("a%2Bb%20c"), "a+b c");
        assert_eq!(url_decode("plain"), "plain");
    }

    #[test]
    fn parse_query_extracts_pairs() {
        let q = parse_query("code=abc123&state=xyz");
        assert_eq!(q.get("code").unwrap(), "abc123");
        assert_eq!(q.get("state").unwrap(), "xyz");
    }

    #[test]
    fn urlencode_preserves_unreserved_escapes_rest() {
        assert_eq!(urlencode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(urlencode("http://x/y"), "http%3A%2F%2Fx%2Fy");
    }
}
