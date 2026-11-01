/**
 * View › Radiological Convention (src-tauri main.rs): the native item asks
 * the UI to toggle the persisted setting (`view-display-action`), and the UI
 * reports the setting so the check mark follows, whatever changed it (the
 * menu, the view's context menu, a restored preference).
 */
import { safeEmit, safeListen, safeUnlisten, type Unlisten } from '@/utils/eventUtils';
import { useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';

let teardown: (() => void) | null = null;

export function initializeViewDisplayMenuService(): void {
  if (teardown) return;
  let disposed = false;
  let unlisten: Unlisten | undefined;
  void safeListen<{ action?: string }>('view-display-action', (event) => {
    if (event.payload?.action === 'toggle-radiological') {
      useViewDisplaySettingsStore.getState().toggleRadiological();
    }
  }).then((fn) => {
    if (disposed) void safeUnlisten(fn);
    else unlisten = fn;
  });

  let last = useViewDisplaySettingsStore.getState().radiological;
  void safeEmit('radiological-convention-changed', { enabled: last });
  const unsubscribe = useViewDisplaySettingsStore.subscribe((state) => {
    if (state.radiological === last) return;
    last = state.radiological;
    void safeEmit('radiological-convention-changed', { enabled: last });
  });

  teardown = () => {
    disposed = true;
    unsubscribe();
    void safeUnlisten(unlisten);
  };
}

export function destroyViewDisplayMenuService(): void {
  teardown?.();
  teardown = null;
}
