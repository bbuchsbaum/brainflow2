// Automated test runner that logs results to console
// This can be imported and run from any component

import { waitForTauri } from './tauri-ready';

interface TestResult {
    name: string;
    passed: boolean;
    error?: any;
    duration: number;
}

export async function runTauriAPITests(): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    console.log('%c=== Tauri API Test Suite ===', 'color: blue; font-weight: bold');
    
    // Wait for Tauri to be ready first
    try {
        await waitForTauri();
        console.log('✅ Tauri is ready');
    } catch (error) {
        console.error('❌ Failed to initialize Tauri:', error);
        return results;
    }
    
    // Test 1: Import Tauri API
    await runTest('Import @tauri-apps/api/core', async () => {
        const module = await import('@tauri-apps/api/core');
        if (!module.invoke) throw new Error('invoke function not found');
    }, results);
    
    // Test 2: Check legacy global
    await runTest('Check window.__TAURI__ (should be undefined)', async () => {
        if ('__TAURI__' in window) {
            console.warn('window.__TAURI__ exists but should not in Tauri v2');
        }
    }, results);
    
    // Test 3: Test file system API
    await runTest('List directory via API', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke('plugin:api-bridge|fs_list_directory', {
            path: '/Users/bbuchsbaum/code/brainflow2'
        });
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from fs_list_directory');
        }
    }, results);
    
    // Test 4: Test loading a file
    await runTest('Load test NIFTI file', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ id: string; name: string; }>('plugin:api-bridge|load_file', {
            path: '/Users/bbuchsbaum/code/brainflow2/test-data/unit/toy_t1w.nii.gz'
        });
        if (!result?.id || !result?.name) {
            throw new Error('Invalid response from load_file');
        }
    }, results);
    
    // Test 5: Initialize render loop
    await runTest('Initialize GPU render loop', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('plugin:api-bridge|init_render_loop');
    }, results);
    
    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    
    console.log(
        `%c=== Summary: ${passed}/${total} tests passed, ${failed} failed ===`,
        failed > 0 ? 'color: red; font-weight: bold' : 'color: green; font-weight: bold'
    );
    
    return results;
}

async function runTest(name: string, testFn: () => Promise<void>, results: TestResult[]) {
    const start = performance.now();
    try {
        await testFn();
        const duration = performance.now() - start;
        results.push({ name, passed: true, duration });
        console.log(`%c✅ ${name}`, 'color: green', `(${duration.toFixed(1)}ms)`);
    } catch (error) {
        const duration = performance.now() - start;
        results.push({ name, passed: false, error, duration });
        console.error(`%c❌ ${name}`, 'color: red', `(${duration.toFixed(1)}ms)`, error);
    }
}

// Auto-run tests when this module is imported in development
if (import.meta.env.DEV) {
    // Run tests after a short delay to ensure app is initialized
    setTimeout(() => {
        runTauriAPITests().then(results => {
            // Store results globally for easy access
            (window as any).__TAURI_TEST_RESULTS__ = results;
            console.log('Test results stored in window.__TAURI_TEST_RESULTS__');
        });
    }, 1000);
}