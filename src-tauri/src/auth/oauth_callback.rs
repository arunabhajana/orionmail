//! Strict, bounded receiver for the temporary OAuth loopback redirect.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::Manager;

const MAX_HEADERS: usize = 16 * 1024;

fn confirmation_page(kind: &str, return_url: &str) -> String {
    let (status, title, message, hint, help) = match kind {
        "accepted" => ("Google response received", "You're almost there", "Google has sent your sign-in response. OrionMail is finishing your connection and will open automatically when ready.", "Your first mail sync starts when ready. The return button is available for 2 minutes.", "If the app does not appear automatically, use Go back to app or select OrionMail on your taskbar. Check the message in OrionMail. If sign-in fails, start a fresh attempt from the app. You do not need to refresh this page."),
        "denied" => ("Sign-in cancelled", "Let's head back", "Google sign-in was cancelled or permission was not granted. Return to OrionMail to try again when you're ready.", "This attempt did not connect an account. The return button is available for 2 minutes.", "Choose Sign in with Google in OrionMail to try again. Select the Google account you want to connect and review the requested permissions."),
        "returned" => ("Return requested", "Continue in OrionMail", "We asked OrionMail to come to the foreground. Continue there to check your sign-in status.", "If the window did not appear, select OrionMail on your taskbar.", "Select the OrionMail icon on your taskbar or in the system tray. Any connection errors and retry options appear inside the app."),
        _ => ("Response not accepted", "Try again from OrionMail", "This browser response could not be matched to the active sign-in attempt. Return to OrionMail and start sign-in again if needed.", "This response has not been used to connect an account.", "Use the latest sign-in tab opened by OrionMail. Older or refreshed sign-in links may no longer be valid. Select OrionMail on your taskbar to continue."),
    };
    let action = if return_url.is_empty() { String::new() } else {
        format!("<a class=\"button\" href=\"{}\">Go back to app <span aria-hidden=\"true\">↗</span></a>", return_url.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;"))
    };
    include_str!("signin_confirmation.html").replace("{{TITLE}}", title).replace("{{STATUS}}", status)
        .replace("{{MESSAGE}}", message).replace("{{HINT}}", hint).replace("{{HELP}}", help)
        .replace("{{ACTION}}", &action).replace("{{LOGO}}", include_str!("../../../public/logo-transparent.svg"))
}

fn write_page(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
}

// Keep only the local return action alive briefly. It cannot exchange codes or
// start another sign-in, and requires this attempt's random state and exact host.
fn wait_for_return(listener: TcpListener, state: String, app: tauri::AppHandle) {
    let deadline = Instant::now() + Duration::from_secs(120);
    let Ok(address) = listener.local_addr() else { return };
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, peer)) if peer.ip().is_loopback() => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let mut bytes = Vec::new();
                while bytes.len() <= MAX_HEADERS && !bytes.ends_with(b"\r\n\r\n") && Instant::now() < deadline {
                    let mut chunk = [0; 1024];
                    match stream.read(&mut chunk) { Ok(0) | Err(_) => break, Ok(n) => bytes.extend_from_slice(&chunk[..n]) }
                }
                let valid = std::str::from_utf8(&bytes).ok().and_then(|raw| validate_request(raw, address.port(), &state).ok()) == Some(Callback::Code("return".into()));
                if valid {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
                    }
                    write_page(&mut stream, "200 OK", &confirmation_page("returned", ""));
                    return;
                }
                write_page(&mut stream, "400 Bad Request", &confirmation_page("invalid", ""));
            }
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    Code(String),
    Denied,
}

pub fn validate_request(
    request: &str,
    port: u16,
    expected_state: &str,
) -> Result<Callback, String> {
    if request.len() > MAX_HEADERS
        || request.find("\r\n\r\n").map(|end| end + 4) != Some(request.len())
    {
        return Err("Invalid callback headers".into());
    }
    let mut lines = request.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or("").split(' ').collect();
    if parts.len() != 3 || parts[0] != "GET" || parts[2] != "HTTP/1.1" {
        return Err("Invalid callback method or HTTP version".into());
    }
    let target = parts[1];
    if !target.starts_with("/?") || target.contains('#') || target.chars().any(char::is_control) {
        return Err("Invalid callback path".into());
    }
    let mut hosts = Vec::new();
    for line in lines.take_while(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or("Invalid callback header")?;
        if name.eq_ignore_ascii_case("host") {
            hosts.push(value.trim());
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || (name.eq_ignore_ascii_case("content-length") && value.trim() != "0")
        {
            return Err("Callback request bodies are not accepted".into());
        }
    }
    if hosts != [format!("127.0.0.1:{port}")] {
        return Err("Invalid callback host".into());
    }
    let url = url::Url::parse(&format!("http://127.0.0.1:{port}{target}"))
        .map_err(|_| "Invalid callback URL")?;
    let unique = |name: &str| -> Result<Option<String>, String> {
        let values: Vec<_> = url
            .query_pairs()
            .filter(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .collect();
        if values.len() > 1 {
            return Err(format!("Duplicate callback {name}"));
        }
        Ok(values.into_iter().next())
    };
    let state = unique("state")?.ok_or("Missing OAuth state")?;
    // State is random and tied to this one listener/PKCE verifier; never accept
    // a code or provider error from another authorization attempt.
    if state.is_empty() || state != expected_state {
        return Err("OAuth state mismatch".into());
    }
    match (unique("code")?, unique("error")?) {
        (Some(code), None)
            if !code.is_empty() && code.len() <= 4096 && !code.chars().any(char::is_control) =>
        {
            Ok(Callback::Code(code))
        }
        (None, Some(error)) if !error.is_empty() => Ok(Callback::Denied),
        _ => Err("Invalid OAuth callback parameters".into()),
    }
}

pub fn receive_code(
    listener: TcpListener,
    state: String,
    deadline: Instant,
    app: Option<tauri::AppHandle>,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let socket_timeout = remaining.min(Duration::from_secs(2));
                stream
                    .set_read_timeout(Some(socket_timeout))
                    .map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(socket_timeout))
                    .map_err(|e| e.to_string())?;
                let mut bytes = Vec::new();
                while bytes.len() <= MAX_HEADERS
                    && !bytes.ends_with(b"\r\n\r\n")
                    && Instant::now() < deadline
                {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    stream
                        .set_read_timeout(Some(remaining.min(Duration::from_secs(2))))
                        .map_err(|e| e.to_string())?;
                    let mut chunk = [0u8; 1024];
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => bytes.extend_from_slice(&chunk[..count]),
                    }
                }
                let parsed = std::str::from_utf8(&bytes)
                    .ok()
                    .and_then(|raw| validate_request(raw, port, &state).ok());
                let query = url::form_urlencoded::Serializer::new(String::new()).append_pair("code", "return").append_pair("state", &state).finish();
                let return_url = if parsed.is_some() && app.is_some() { format!("http://127.0.0.1:{port}/?{query}") } else { String::new() };
                let kind = match &parsed { Some(Callback::Code(_)) => "accepted", Some(Callback::Denied) => "denied", None => "invalid" };
                write_page(&mut stream, if parsed.is_some() { "200 OK" } else { "400 Bad Request" }, &confirmation_page(kind, &return_url));
                if parsed.is_some() {
                    if let Some(app) = app { std::thread::spawn(move || wait_for_return(listener, state, app)); }
                    return match parsed { Some(Callback::Code(code)) => Ok(code), _ => Err("Google sign-in was cancelled or denied".into()) };
                }
                // Stray/invalid requests cannot consume the real callback.
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(error) => return Err(format!("OAuth callback listener failed: {error}")),
        }
    }
    Err("Google sign-in timed out. Please try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmation_distinguishes_pending_cancelled_and_invalid_without_leaking_codes() {
        let page = confirmation_page("accepted", "http://127.0.0.1:1234/?code=return&state=test");
        assert!(page.contains("You're almost there"));
        assert!(page.contains("Go back to app"));
        assert!(page.contains("&amp;state=test"));
        assert!(!page.contains("{{"));
        assert!(confirmation_page("denied", "").contains("Sign-in cancelled"));
        assert!(!confirmation_page("invalid", "").contains("href="));
        assert!(confirmation_page("returned", "").contains("taskbar"));
    }
    fn request(query: &str) -> String {
        format!("GET /?{query} HTTP/1.1\r\nHost: 127.0.0.1:43210\r\n\r\n")
    }
    #[test]
    fn accepts_only_matching_state_and_unambiguous_code() {
        assert_eq!(
            validate_request(&request("code=abc&state=secret"), 43210, "secret").unwrap(),
            Callback::Code("abc".into())
        );
        for query in [
            "code=abc",
            "code=abc&state=other",
            "code=abc&state=secret&state=secret",
            "code=a&%63ode=b&state=secret",
            "code=a&error=denied&state=secret",
            "code=&state=secret",
        ] {
            assert!(
                validate_request(&request(query), 43210, "secret").is_err(),
                "{query}"
            );
        }
        assert_eq!(
            validate_request(
                &request("error=access_denied&state=secret"),
                43210,
                "secret"
            )
            .unwrap(),
            Callback::Denied
        );
        assert!(
            validate_request(&request("error=access_denied&state=wrong"), 43210, "secret").is_err()
        );
    }
    #[test]
    fn rejects_wrong_method_path_host_and_request_body() {
        let valid = request("code=a&state=secret");
        for raw in [
            valid.replace("GET", "POST"),
            valid.replace("/?", "/other?"),
            valid.replace("127.0.0.1", "evil.test"),
            valid.replace("\r\n\r\n", "\r\nHost: 127.0.0.1:43210\r\n\r\n"),
            valid.replace("\r\n\r\n", "\r\nContent-Length: 12\r\n\r\n"),
        ] {
            assert!(validate_request(&raw, 43210, "secret").is_err());
        }
    }
    #[test]
    fn unused_listener_expires() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(receive_code(listener, "secret".into(), Instant::now(), None)
            .unwrap_err()
            .contains("timed out"));
    }
}
