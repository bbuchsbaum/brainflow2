import { test, expect } from '@playwright/test';
import { waitForTauriApp } from '../utils/tauri-helpers';

test.describe('Integration Check', () => {
  test('should verify E2E framework can interact with Tauri app', async ({ page }) => {
    // Basic connectivity test
    await waitForTauriApp(page);
    
    // Check Tauri is available
    const tauriAvailable = await page.evaluate(() => {
      return (window as any).__TAURI__ !== undefined;
    });
    
    expect(tauriAvailable).toBeTruthy();
    
    // Try to invoke a simple Tauri command
    const commandResult = await page.evaluate(async () => {
      try {
        const { invoke } = (window as any).__TAURI__.core;
        // Try a safe command that should exist
        const result = await invoke('get_render_config');
        return { success: true, data: result };
      } catch (error: any) {
        return { success: false, error: error.toString() };
      }
    });
    
    console.log('Tauri command result:', commandResult);
    
    // Log available commands for debugging
    const availableCommands = await page.evaluate(() => {
      const tauri = (window as any).__TAURI__;
      if (tauri && tauri.invoke) {
        return 'Legacy invoke available';
      } else if (tauri && tauri.core && tauri.core.invoke) {
        return 'Core invoke available';
      } else {
        return 'No invoke found';
      }
    });
    
    console.log('Tauri invoke status:', availableCommands);
  });
});