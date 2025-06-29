// Test shader validation and error reporting

use render_loop::shaders::ShaderManager;

#[test]
fn test_empty_shader_validation() {
    let validation = ShaderManager::validate_shader("", "empty");
    assert!(!validation.valid);
    assert!(!validation.errors.is_empty());
    assert!(validation.errors[0].contains("empty"));
}

#[test]
fn test_missing_entry_point_warning() {
    // Shader with functions but no entry points should warn
    let shader_code = r#"
        struct VertexOutput {
            @builtin(position) position: vec4<f32>,
        }
        
        fn helper_function() -> vec4<f32> {
            return vec4<f32>(0.0);
        }
        // Missing entry point decorators
    "#;
    
    let validation = ShaderManager::validate_shader(shader_code, "test");
    
    assert!(validation.valid); // Still valid, just a warning
    assert!(!validation.warnings.is_empty(), "Expected warnings but got none");
    assert!(validation.warnings[0].contains("entry points"));
}

#[test]
fn test_switch_syntax_validation() {
    let bad_switch = r#"
        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
            let x = 1u;
            switch x {  // Missing parentheses
                case 0u: { return vec4<f32>(1.0); }
                default: { return vec4<f32>(0.0); }
            }
        }
    "#;
    
    let validation = ShaderManager::validate_shader(bad_switch, "test");
    assert!(!validation.valid);
    assert!(!validation.errors.is_empty());
    assert!(validation.errors[0].contains("switch"));
}

#[test]
fn test_vec3_alignment_warning() {
    let shader_with_vec3 = r#"
        struct Uniforms {
            @size(16) position: vec3<f32>,  // Should warn about alignment
            color: vec4<f32>,
        }
        
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        
        @vertex
        fn vs_main() -> @builtin(position) vec4<f32> {
            return vec4<f32>(uniforms.position, 1.0);
        }
    "#;
    
    let validation = ShaderManager::validate_shader(shader_with_vec3, "test");
    assert!(validation.valid);
    assert!(!validation.warnings.is_empty());
    assert!(validation.warnings.iter().any(|w| w.contains("vec3") && w.contains("padding")));
}

#[test]
fn test_slice_shader_requirements() {
    // Test that slice shader requires specific entry points
    let incomplete_slice = r#"
        @vertex
        fn some_other_name() -> @builtin(position) vec4<f32> {
            return vec4<f32>(0.0);
        }
    "#;
    
    let validation = ShaderManager::validate_shader(incomplete_slice, "slice");
    assert!(!validation.valid);
    assert!(validation.errors.iter().any(|e| e.contains("vs_main")));
    assert!(validation.errors.iter().any(|e| e.contains("fs_main")));
}

#[test]
fn test_valid_shader_passes() {
    let valid_shader = r#"
        @vertex
        fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
            return vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }
        
        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
            return vec4<f32>(1.0, 0.0, 0.0, 1.0);
        }
    "#;
    
    let validation = ShaderManager::validate_shader(valid_shader, "test");
    assert!(validation.valid);
    assert!(validation.errors.is_empty());
}

#[test]
fn test_shader_compilation_error_handling() {
    // Test our validation catches errors before wgpu compilation
    let _shader_manager = ShaderManager::new();
    
    // Try to validate an empty shader
    let result = ShaderManager::validate_shader("", "test");
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("empty")));
    
    // Try to validate a shader with bad switch syntax
    let bad_shader = r#"
        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
            switch x {  // Bad syntax
                default: { return vec4<f32>(0.0); }
            }
        }
    "#;
    
    let result = ShaderManager::validate_shader(bad_shader, "test");
    assert!(!result.valid);
    assert!(result.errors.iter().any(|e| e.contains("switch")));
}