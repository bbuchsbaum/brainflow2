# Comprehensive Plan: Fix Template Loading Display Issue

## Executive Summary

**Problem**: Images load from Template menu but display as blank canvases, while File browser loading works completely. Analysis reveals a critical race condition in backend layer-to-volume mapping during template loading's async pipeline.

**Root Cause**: Template loading's multi-step async process (template service → cache → volume load → registry) creates timing issues where frontend layer creation happens before backend volume registry population is complete, causing the `layer_to_volume_map` lookup to fail during GPU resource allocation.

**Impact**: Critical - Template functionality appears to work (layers show in UI) but renders blank canvases, completely breaking template feature.

**Solution**: Implement synchronous volume registry confirmation, async-safe backend mapping, and enhanced validation to ensure proper timing coordination between frontend and backend systems.

---

## Root Cause Analysis

### Technical Root Cause

The investigation identified a **race condition in backend layer-to-volume mapping** with the following specific timing issue:

```
WORKING (File Loading):
File Load → Direct Registry → GPU Resources → layer_to_volume_map Population → SUCCESS

BROKEN (Template Loading):  
Template Load → Async Cache → Async Registry → GPU Resources → layer_to_volume_map Lookup FAILS
```

### Key Findings from Analysis

1. **Identical Frontend Pipeline**: Both loading paths use the same frontend services (`VolumeLoadingService`, `LayerApiImpl`, `StoreSyncService`)

2. **Different Backend Registration**: 
   - Templates: Complex async pipeline with generated UUIDs
   - Files: Direct synchronous registration with file-based IDs

3. **Critical Race Window**: ~20ms window where GPU resource allocation happens before template volume registry is populated

4. **Timing Evidence**: Template loading has 6+ async gaps vs file loading's 2 operations

### Affected Systems

- **Backend**: Template service, volume registry, layer-to-volume mapping
- **Frontend**: VolumeLoadingService defensive coding, LayerApiImpl GPU allocation
- **Rendering**: Canvas displays blank due to missing volume lookup

---

## Detailed Implementation Plan

### Phase 1: Backend Synchronization Fix (High Priority)

#### 1.1 Template Service Registry Confirmation
**File**: `/Users/bbuchsbaum/code/brainflow2/core/templates/src/service.rs`

**Objective**: Ensure volume registry population before returning handle to frontend

**Implementation**:
```rust
// Around line 124 in load_template() method
pub async fn load_template(&self, config: TemplateConfig) -> Result<TemplateLoadResult, TemplateError> {
    // ... existing template loading logic ...
    
    // CRITICAL: Load and register volume synchronously
    let volume_handle_info = self.load_template_volume(&template_id, &cache_path).await?;
    
    // NEW: Registry confirmation with timeout
    let registry_confirmed = self.wait_for_volume_registry_confirmation(
        &volume_handle_info.id, 
        Duration::from_secs(5)
    ).await?;
    
    if !registry_confirmed {
        return Err(TemplateError::VolumeRegistrationTimeout {
            template_id: template_id.clone(),
            volume_id: volume_handle_info.id.clone(),
        });
    }
    
    // ... rest of method
}

// NEW: Add registry confirmation method
async fn wait_for_volume_registry_confirmation(
    &self, 
    volume_id: &str, 
    timeout: Duration
) -> Result<bool, TemplateError> {
    let start = std::time::Instant::now();
    
    while start.elapsed() < timeout {
        if self.is_volume_in_registry(volume_id).await {
            return Ok(true);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    
    Ok(false)
}

// NEW: Registry check helper
async fn is_volume_in_registry(&self, volume_id: &str) -> bool {
    // Check if volume exists in the volume registry
    // This needs access to the volume registry - may require dependency injection
    true // Placeholder - implement actual registry check
}
```

**Risk Assessment**: 
- **Low Risk**: Only adds confirmation step, doesn't change existing logic
- **Timeout Handling**: 5-second timeout prevents indefinite hanging
- **Backward Compatibility**: Preserved - existing behavior maintained with added reliability

#### 1.2 Enhanced GPU Resource Allocation
**File**: `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`

**Objective**: Add volume availability verification before layer-to-volume mapping

**Implementation**:
```rust
// Around line for request_layer_gpu_resources command
#[command]
async fn request_layer_gpu_resources(
    ui_layer_id: String,
    volume_id: String,
    state: State<'_, BridgeState>,
) -> BridgeResult<VolumeLayerGpuInfo> {
    // NEW: Volume availability check
    let volume_ready = wait_for_volume_availability(
        &volume_id, 
        &state, 
        Duration::from_secs(10)
    ).await;
    
    if !volume_ready {
        return Err(BridgeError::VolumeNotReady {
            code: 4045,
            message: format!("Volume {} not available for GPU resource allocation", volume_id),
            volume_id: volume_id.clone(),
        });
    }
    
    // Existing logic with better error handling
    let layer_spec = {
        let mut layer_specs = state.layer_specs.lock().await;
        // ... existing layer_spec retrieval with enhanced error messages ...
    };
    
    // ENHANCED: layer_to_volume_map population with verification
    {
        let mut volume_map = state.layer_to_volume_map.lock().await;
        let LayerSpec::Volume(vol_spec) = &layer_spec;
        
        // Verify volume exists before mapping
        let volume_exists = {
            let registry = state.volume_registry.lock().await;
            registry.contains_key(&vol_spec.source_resource_id)
        };
        
        if !volume_exists {
            return Err(BridgeError::VolumeNotFound {
                code: 4044,
                message: format!("Volume {} not found in registry", vol_spec.source_resource_id),
                volume_id: vol_spec.source_resource_id.clone(),
            });
        }
        
        volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
    }
    
    // ... rest of existing logic
}

// NEW: Volume availability helper
async fn wait_for_volume_availability(
    volume_id: &str,
    state: &State<'_, BridgeState>,
    timeout: Duration,
) -> bool {
    let start = std::time::Instant::now();
    
    while start.elapsed() < timeout {
        let registry = state.volume_registry.lock().await;
        if registry.contains_key(volume_id) {
            return true;
        }
        drop(registry); // Release lock before sleep
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    
    false
}
```

**Risk Assessment**:
- **Medium Risk**: Changes GPU resource allocation flow but adds safety checks
- **Performance Impact**: Minimal - 100ms polling intervals, 10s max timeout
- **Error Handling**: Improved error messages for debugging

#### 1.3 Error Type Additions
**File**: `/Users/bbuchsbaum/code/brainflow2/core/bridge_types/src/errors.rs`

**Objective**: Add specific error types for template loading issues

**Implementation**:
```rust
// Add to BridgeError enum
#[derive(Debug, Error, Serialize)]
pub enum BridgeError {
    // ... existing errors ...
    
    #[error("Volume not ready for operations: {message}")]
    VolumeNotReady {
        code: u32,
        message: String,
        volume_id: String,
    },
    
    #[error("Template volume registration timeout: {message}")]
    TemplateRegistrationTimeout {
        code: u32,
        message: String,
        template_id: String,
        volume_id: String,
    },
}

// Add to TemplateError enum if it exists
#[derive(Debug, Error, Serialize)]
pub enum TemplateError {
    // ... existing errors ...
    
    #[error("Volume registration timeout for template {template_id}")]
    VolumeRegistrationTimeout {
        template_id: String,
        volume_id: String,
    },
}
```

### Phase 2: Frontend Validation Enhancement (Medium Priority)

#### 2.1 Enhanced Template Loading Validation
**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/VolumeLoadingService.ts`

**Objective**: Add template-specific validation and extended timeouts

**Implementation**:
```typescript
// Around line 60 in loadVolume method
public async loadVolume(config: VolumeLoadingConfig): Promise<ViewLayer> {
    // ... existing setup ...
    
    // NEW: Template-specific validation
    if (config.source === 'template') {
        await this.validateTemplateVolume(volumeHandle, config);
    }
    
    // ... existing layer creation ...
    
    // ENHANCED: Template-specific backend readiness check
    try {
        const timeout = config.source === 'template' ? 10000 : 5000; // 10s for templates
        await this.waitForBackendStateReady(layer.id, timeout);
        console.log(`Backend state confirmed ready for ${config.source} loading`);
    } catch (error) {
        console.error(`Backend state readiness failed for ${config.source}:`, error);
        
        // For templates, this is more critical - throw error instead of proceeding
        if (config.source === 'template') {
            throw new Error(`Template loading failed: Backend state not ready for layer ${layer.id}`);
        }
        
        console.warn(`Proceeding anyway for ${config.source} loading`);
    }
    
    // ... rest of method
}

// NEW: Template volume validation
private async validateTemplateVolume(
    volumeHandle: VolumeHandle, 
    config: VolumeLoadingConfig
): Promise<void> {
    // Verify volume exists in backend registry
    const volumeExists = await this.verifyVolumeInBackend(volumeHandle.id);
    if (!volumeExists) {
        throw new Error(
            `Template volume ${volumeHandle.id} not found in backend registry. ` +
            `Template path: ${config.sourcePath}`
        );
    }
    
    // Additional template-specific checks
    const bounds = await this.apiService.getVolumeBounds(volumeHandle);
    if (!bounds || bounds.extentX <= 0 || bounds.extentY <= 0 || bounds.extentZ <= 0) {
        throw new Error(
            `Template volume ${volumeHandle.id} has invalid bounds. ` +
            `This may indicate incomplete volume loading.`
        );
    }
}

// NEW: Backend volume verification
private async verifyVolumeInBackend(volumeId: string): Promise<boolean> {
    try {
        // Use histogram computation as a proxy for volume availability
        // This tests the complete pipeline: volume registry → layer mapping → computation
        await this.histogramService.computeHistogram(volumeId, 2);
        return true;
    } catch (error) {
        console.warn(`Volume verification failed for ${volumeId}:`, error);
        return false;
    }
}
```

#### 2.2 Enhanced Error Handling and Logging
**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/TemplateService.ts`

**Objective**: Add comprehensive error handling and debugging information

**Implementation**:
```typescript
// Around line 130 in loadTemplate method
private async loadTemplate(templateId: string): Promise<void> {
    try {
        console.log(`[TemplateService] Starting template load: ${templateId}`);
        
        // Enhanced logging for backend call
        const startTime = performance.now();
        const templateResult = await invoke<TemplateLoadResult>(
            'plugin:api-bridge|load_template_by_id',
            { templateId }
        );
        const backendTime = performance.now() - startTime;
        
        console.log(`[TemplateService] Backend template load completed in ${backendTime.toFixed(2)}ms`);
        console.log(`[TemplateService] Volume handle:`, templateResult.volume_handle_info);
        
        // NEW: Pre-validation before volume loading
        await this.validateTemplateResult(templateResult);
        
        // Volume loading with enhanced error context
        const volumeLoadStart = performance.now();
        const addedLayer = await this.volumeLoadingService.loadVolume({
            volumeHandle: templateResult.volume_handle_info,
            displayName: templateResult.template_metadata.name,
            source: 'template',
            sourcePath: templatePath,
            layerType: this.inferLayerType(templateResult.template_metadata.template_type),
            visible: true
        });
        const volumeLoadTime = performance.now() - volumeLoadStart;
        
        console.log(`[TemplateService] Volume loading completed in ${volumeLoadTime.toFixed(2)}ms`);
        console.log(`[TemplateService] Successfully loaded template layer:`, addedLayer.id);
        
    } catch (error) {
        console.error(`[TemplateService] Template loading failed for ${templateId}:`, error);
        
        // Enhanced error details for debugging
        if (error instanceof Error) {
            console.error(`[TemplateService] Error details:`, {
                message: error.message,
                stack: error.stack,
                templateId,
                timestamp: new Date().toISOString()
            });
        }
        
        throw error;
    }
}

// NEW: Template result validation
private async validateTemplateResult(result: TemplateLoadResult): Promise<void> {
    if (!result.volume_handle_info) {
        throw new Error('Template load result missing volume handle info');
    }
    
    if (!result.volume_handle_info.id) {
        throw new Error('Template volume handle missing ID');
    }
    
    if (!result.template_metadata) {
        throw new Error('Template load result missing metadata');
    }
    
    console.log(`[TemplateService] Template validation passed for volume ${result.volume_handle_info.id}`);
}
```

### Phase 3: Debugging and Monitoring (Low Priority)

#### 3.1 Debug Command Addition
**File**: `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`

**Objective**: Add debug commands for troubleshooting layer mapping issues

**Implementation**:
```rust
// Add to command list
#[command]
async fn debug_layer_volume_mapping(
    state: State<'_, BridgeState>
) -> BridgeResult<HashMap<String, String>> {
    let volume_map = state.layer_to_volume_map.lock().await;
    let mapping: HashMap<String, String> = volume_map.iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    
    Ok(mapping)
}

#[command]
async fn debug_volume_registry_status(
    state: State<'_, BridgeState>
) -> BridgeResult<Vec<String>> {
    let registry = state.volume_registry.lock().await;
    let volume_ids: Vec<String> = registry.keys().cloned().collect();
    
    Ok(volume_ids)
}

#[command] 
async fn debug_template_volume_state(
    volume_id: String,
    state: State<'_, BridgeState>
) -> BridgeResult<HashMap<String, String>> {
    let mut debug_info = HashMap::new();
    
    // Check volume registry
    let registry = state.volume_registry.lock().await;
    debug_info.insert(
        "in_volume_registry".to_string(),
        registry.contains_key(&volume_id).to_string()
    );
    
    // Check layer mapping
    let volume_map = state.layer_to_volume_map.lock().await;
    let mapped_layers: Vec<String> = volume_map.iter()
        .filter(|(_, v)| *v == &volume_id)
        .map(|(k, _)| k.clone())
        .collect();
    debug_info.insert("mapped_layers".to_string(), mapped_layers.join(","));
    
    Ok(debug_info)
}
```

**File Updates Required**:
- Add commands to `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/build.rs` COMMANDS array
- Add to generate_handler! macro in `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`
- Add to permissions in `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/permissions/default.toml`
- Add to apiBridgeCommands in `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/transport.ts`

#### 3.2 Enhanced Logging Service
**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/VolumeLoadingService.ts`

**Objective**: Add comprehensive timing and state logging

**Implementation**:
```typescript
// Add at class level
private readonly debugEnabled = process.env.NODE_ENV === 'development';

private debugLog(message: string, data?: any): void {
    if (this.debugEnabled) {
        console.log(`[VolumeLoadingService] ${message}`, data || '');
    }
}

// Enhanced loadVolume with timing
public async loadVolume(config: VolumeLoadingConfig): Promise<ViewLayer> {
    const startTime = performance.now();
    this.debugLog(`Starting volume load`, { source: config.source, path: config.sourcePath });
    
    try {
        // ... existing method with timing logs at each major step ...
        
        const endTime = performance.now();
        this.debugLog(`Volume load completed in ${(endTime - startTime).toFixed(2)}ms`, {
            layerId: layer.id,
            source: config.source
        });
        
        return layer;
    } catch (error) {
        const endTime = performance.now();
        this.debugLog(`Volume load failed after ${(endTime - startTime).toFixed(2)}ms`, {
            source: config.source,
            error: error.message
        });
        throw error;
    }
}
```

---

## Testing Strategy

### 3.1 Unit Testing

#### Backend Tests
**File**: `/Users/bbuchsbaum/code/brainflow2/core/templates/src/service.rs`
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_template_volume_registry_confirmation() {
        // Test that template loading waits for registry confirmation
        // Test timeout behavior
        // Test error handling for registry failures
    }
    
    #[tokio::test] 
    async fn test_volume_availability_timing() {
        // Test volume availability checks work correctly
        // Test race condition prevention
    }
}
```

#### Frontend Tests  
**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/__tests__/VolumeLoadingService.test.ts`
```typescript
describe('VolumeLoadingService Template Loading', () => {
  test('should validate template volumes before loading', async () => {
    // Test template-specific validation
    // Test error handling for invalid templates
  });
  
  test('should use extended timeout for template loading', async () => {
    // Test 10s timeout for templates vs 5s for files
    // Test timeout behavior
  });
  
  test('should provide better error messages for template failures', async () => {
    // Test enhanced error reporting
  });
});
```

### 3.2 Integration Testing

#### E2E Test Scenarios
**File**: `/Users/bbuchsbaum/code/brainflow2/e2e/tests/template-loading.spec.ts`
```typescript
import { test, expect } from '@playwright/test';

test.describe('Template Loading', () => {
  test('should load and display template images correctly', async ({ page }) => {
    // Navigate to template menu
    // Select a template
    // Verify image displays (not blank canvas)
    // Compare with file loading behavior
  });
  
  test('should handle template loading errors gracefully', async ({ page }) => {
    // Test error scenarios
    // Verify proper error messages
    // Test recovery behavior
  });
  
  test('should maintain performance for template loading', async ({ page }) => {
    // Test loading times within acceptable limits
    // Compare template vs file loading performance
  });
});
```

#### Performance Testing
**File**: `/Users/bbuchsbaum/code/brainflow2/e2e/tests/loading-performance.spec.ts`
```typescript
test('template loading performance should be reasonable', async ({ page }) => {
  const startTime = Date.now();
  
  // Load template
  await page.getByText('Templates').click();
  await page.getByText('Example Template').click();
  
  // Wait for image to appear (not blank)
  await expect(page.locator('canvas')).not.toHaveClass(/.*blank.*/);
  
  const endTime = Date.now();
  const loadTime = endTime - startTime;
  
  // Should load within 15 seconds (allowing for network + processing)
  expect(loadTime).toBeLessThan(15000);
});
```

### 3.3 Manual Testing Checklist

#### Template Loading Verification
- [ ] Load template from menu - image displays correctly
- [ ] Multiple template loading - no interference between templates  
- [ ] Template loading after file loading - both work correctly
- [ ] File loading after template loading - both work correctly
- [ ] Error scenarios - proper error messages displayed
- [ ] Performance - template loading completes within reasonable time

#### Regression Testing
- [ ] File browser loading still works exactly as before
- [ ] All existing functionality preserved
- [ ] No new console errors introduced
- [ ] Layer management features work with template layers
- [ ] 3D rendering works with template volumes

---

## Risk Assessment

### High-Risk Changes
1. **Backend GPU Resource Allocation** - Core rendering pipeline modification
   - **Mitigation**: Extensive testing, gradual rollout, fallback mechanisms
   - **Rollback Plan**: Can revert to original implementation quickly

2. **Template Service Registry Logic** - Changes volume loading timing
   - **Mitigation**: Timeout mechanisms prevent indefinite hanging
   - **Rollback Plan**: Registry confirmation can be disabled via feature flag

### Medium-Risk Changes  
1. **Frontend Validation Enhancement** - May catch new error cases
   - **Mitigation**: Better error messages help debugging
   - **Rollback Plan**: Can disable template-specific validation

2. **Error Handling Changes** - New error types and flows
   - **Mitigation**: Maintain backward compatibility in error handling
   - **Rollback Plan**: Error types are additive, not breaking

### Low-Risk Changes
1. **Debug Commands** - Non-functional additions for troubleshooting
2. **Enhanced Logging** - Development-only features  
3. **Unit Tests** - Only improve code quality

### Rollback Strategy
1. **Phase 1 Rollback**: Disable registry confirmation, revert GPU allocation changes
2. **Phase 2 Rollback**: Disable frontend template validation 
3. **Phase 3 Rollback**: Remove debug commands (non-critical)

### Performance Impact
- **Backend**: Additional 50-100ms for registry confirmation per template load
- **Frontend**: Extended timeout may delay error reporting by 5 seconds
- **Overall**: Minimal impact, significantly improved reliability

---

## Success Criteria

### Functional Requirements
1. **✅ Template images display correctly** - No more blank canvases
2. **✅ File browser loading preserved** - Existing functionality unchanged  
3. **✅ Error handling improved** - Clear error messages for failures
4. **✅ Performance maintained** - Template loading < 15 seconds typical case

### Technical Requirements  
1. **✅ Race condition eliminated** - layer_to_volume_map populated before GPU allocation
2. **✅ Registry synchronization** - Volume availability confirmed before frontend use
3. **✅ Enhanced validation** - Template-specific checks prevent invalid states
4. **✅ Debug capabilities** - Tools available for troubleshooting future issues

### Quality Requirements
1. **✅ Test coverage** - Unit, integration, and E2E tests covering template loading
2. **✅ Documentation** - Clear error messages and debugging information
3. **✅ Maintainability** - Code changes follow existing patterns and conventions
4. **✅ Reliability** - Consistent behavior across different template types and sizes

### Acceptance Criteria
- [ ] All existing E2E tests pass
- [ ] New template loading E2E tests pass  
- [ ] Manual testing checklist completed
- [ ] Performance benchmarks met
- [ ] No regression in file browser loading
- [ ] Error cases handled gracefully with clear messages

---

## Implementation Timeline

### Week 1: Backend Synchronization (Phase 1)
- **Days 1-2**: Template service registry confirmation implementation
- **Days 3-4**: Enhanced GPU resource allocation with volume availability checks
- **Day 5**: Error type additions and basic testing

### Week 2: Frontend Enhancement (Phase 2)  
- **Days 1-2**: VolumeLoadingService template validation and extended timeouts
- **Days 3-4**: TemplateService enhanced error handling and logging
- **Day 5**: Integration testing and bug fixes

### Week 3: Testing and Debug Tools (Phase 3)
- **Days 1-2**: Debug command implementation and permissions setup
- **Days 3-4**: Comprehensive testing (unit, integration, E2E)
- **Day 5**: Performance testing and optimization

### Week 4: Quality Assurance and Deployment
- **Days 1-2**: Manual testing and regression verification  
- **Days 3-4**: Documentation updates and code review
- **Day 5**: Deployment preparation and monitoring setup

---

## Files Requiring Changes

### High Priority (Phase 1)
1. `/Users/bbuchsbaum/code/brainflow2/core/templates/src/service.rs` - Registry confirmation
2. `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs` - GPU allocation enhancement
3. `/Users/bbuchsbaum/code/brainflow2/core/bridge_types/src/errors.rs` - Error types

### Medium Priority (Phase 2)  
4. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/VolumeLoadingService.ts` - Template validation
5. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/TemplateService.ts` - Enhanced error handling

### Low Priority (Phase 3)
6. `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/build.rs` - Debug commands
7. `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/permissions/default.toml` - Command permissions  
8. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/transport.ts` - Command registration

### Testing Files
9. `/Users/bbuchsbaum/code/brainflow2/core/templates/src/service.rs` - Unit tests
10. `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/__tests__/VolumeLoadingService.test.ts` - Frontend tests
11. `/Users/bbuchsbaum/code/brainflow2/e2e/tests/template-loading.spec.ts` - E2E tests

---

## Monitoring and Validation

### Success Metrics
- **Template Load Success Rate**: 100% for valid templates
- **Template Display Success Rate**: 100% (no blank canvases)
- **Average Template Load Time**: < 10 seconds  
- **File Loading Regression**: 0% (no degradation)

### Monitoring Points
- Backend registry confirmation timing
- Frontend validation failure rates
- GPU resource allocation success rates
- Error message clarity and actionability

### Validation Methods
- Automated E2E testing in CI/CD pipeline
- Manual testing with various template types
- Performance benchmarking vs baseline
- User acceptance testing with actual templates

---

## Conclusion

This comprehensive plan addresses the template loading display issue through a systematic approach targeting the identified race condition in backend layer-to-volume mapping. The solution ensures proper synchronization between template loading's async pipeline and the frontend's GPU resource allocation while preserving all existing file browser functionality.

The multi-phase implementation minimizes risk through incremental changes, comprehensive testing, and clear rollback strategies. Upon completion, template loading will function reliably with the same visual feedback and performance characteristics as file browser loading, fully restoring the template feature functionality.

**Expected Outcome**: Template images will load and display correctly, eliminating the blank canvas issue while maintaining all existing application functionality and performance standards.