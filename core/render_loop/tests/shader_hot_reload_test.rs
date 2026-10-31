//! Shader hot-reload must skip `// @include` fragments: a fragment has no entry
//! points, so loading it alone hands wgpu invalid WGSL (a validation panic).

use std::path::Path;
use std::time::{Duration, SystemTime};

use render_loop::shaders::{is_include_fragment, INCLUDE_FRAGMENTS};
use render_loop::RenderLoopService;

const SHADER_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/shaders");

fn touch(name: &str) {
    let path = Path::new(SHADER_DIR).join(format!("{name}.wgsl"));
    std::fs::File::options()
        .write(true)
        .open(&path)
        .and_then(|file| file.set_modified(SystemTime::now()))
        .unwrap_or_else(|e| panic!("failed to touch {}: {e}", path.display()));
}

#[test]
fn include_fragment_list_matches_the_shader_directory() {
    for name in INCLUDE_FRAGMENTS {
        assert!(
            Path::new(SHADER_DIR).join(format!("{name}.wgsl")).exists(),
            "{name} is listed as a fragment but has no shader file"
        );
    }
    for entry in std::fs::read_dir(SHADER_DIR).expect("shader directory") {
        let path = entry.expect("shader entry").path();
        if path.extension().is_none_or(|ext| ext != "wgsl") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("shader source");
        for line in source.lines() {
            let Some(name) = line.trim().strip_prefix("// @include ") else {
                continue;
            };
            if Path::new(SHADER_DIR).join(format!("{name}.wgsl")).exists() {
                assert!(
                    is_include_fragment(name),
                    "{} includes the file fragment {name}, which INCLUDE_FRAGMENTS must list",
                    path.display()
                );
            }
        }
    }
}

#[tokio::test]
async fn hot_reload_skips_include_fragments() {
    let mut service = RenderLoopService::new()
        .await
        .expect("failed to initialize render service");
    service.load_shaders().expect("failed to load shaders");
    service
        .enable_shader_hot_reload()
        .expect("failed to enable shader hot reload");

    // The watcher polls every 500 ms; its baseline is the current mtimes.
    std::thread::sleep(Duration::from_millis(50));
    touch("label_outline");
    std::thread::sleep(Duration::from_millis(1200));
    let updated = service
        .check_shader_updates()
        .expect("checking shader updates failed");
    assert!(!updated, "a fragment change must not reload a shader");

    // Control: a whole shader still reloads.
    touch("slice_world_space_masked");
    std::thread::sleep(Duration::from_millis(1200));
    let updated = service
        .check_shader_updates()
        .expect("checking shader updates failed");
    assert!(updated, "a full shader change should reload it");
}
