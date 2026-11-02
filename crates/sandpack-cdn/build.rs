//! Stamps the build identity reported by `GET /version`: the git commit, whether
//! the crate had uncommitted changes, and the build time. A deployed binary must
//! be identifiable without access to the host (prod 2026-11-01 ran a stale
//! binary that only answered `/health: ok`).
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8(output.stdout).ok()?.trim().to_string())
}

fn main() {
    let commit = git(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".to_string());
    // Changes to this crate only; other workspace packages do not affect the binary.
    let dirty = match git(&["status", "--porcelain", "--", "."]) {
        Some(status) => !status.is_empty(),
        None => true,
    };
    let built_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);

    println!("cargo:rustc-env=SANDPACK_CDN_COMMIT={commit}");
    println!("cargo:rustc-env=SANDPACK_CDN_DIRTY={dirty}");
    println!("cargo:rustc-env=SANDPACK_CDN_BUILT_AT={built_at}");
    println!(
        "cargo:rustc-env=SANDPACK_CDN_TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );

    for path in ["src", "Cargo.toml", "Cargo.lock", "build.rs"] {
        println!("cargo:rerun-if-changed={path}");
    }
    if let Some(git_dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        println!("cargo:rerun-if-changed={git_dir}/HEAD");
        println!("cargo:rerun-if-changed={git_dir}/index");
        if let Some(head_ref) = git(&["symbolic-ref", "-q", "HEAD"]) {
            println!("cargo:rerun-if-changed={git_dir}/{head_ref}");
        }
    }
}
