fn main() {
  // Emit OAuth credentials from .env as compile-time env vars.
  // This ensures they are baked into the binary so token refresh works
  // in production installs where no .env file exists at runtime.
  let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
  if env_path.exists() {
    let content = std::fs::read_to_string(&env_path).expect("Failed to read .env");
    for line in content.lines() {
      let line = line.trim();
      if line.is_empty() || line.starts_with('#') {
        continue;
      }
      if let Some((key, value)) = line.split_once('=') {
        let key = key.trim();
        let value = value.trim();
        // Only emit known safe credential keys
        if matches!(key, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET") {
          println!("cargo:rustc-env={}={}", key, value);
        }
      }
    }
  }

  // Re-run this build script if .env changes
  println!("cargo:rerun-if-changed=.env");

  // Unit-test harnesses do not inherit Tauri's executable resources. rfd's
  // TaskDialogIndirect import requires Common Controls v6 before main starts.
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
      && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    // The app binary already links Tauri's full manifest as resource ID 1.
    // Disable linker-generated manifests for that target only, avoiding a
    // duplicate resource while leaving the library test harness covered.
    println!("cargo:rustc-link-arg-bin=app=/MANIFEST:NO");
  }
  tauri_build::build()
}

