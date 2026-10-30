/**
 * Brainflow › Settings… (Cmd+,) in the native app menu emits
 * `app-settings-action`; the Settings dialog opens on the `open-app-settings`
 * window event (App.tsx), so forward it.
 */

import { useEffect } from 'react';
import { safeListen, safeUnlisten } from '@/utils/eventUtils';

export function useAppSettingsMenuListener() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void safeListen('app-settings-action', () => {
      window.dispatchEvent(new Event('open-app-settings'));
    }).then((fn) => {
      if (disposed) void safeUnlisten(fn);
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      void safeUnlisten(unlisten);
    };
  }, []);
}
