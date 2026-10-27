/**
 * The two "get data in" actions, shared by the Files rail and every empty
 * pane (EmptyPane): the native file picker (Open file…, Cmd/Ctrl+Shift+O)
 * and the folder picker (Mount directory, Cmd/Ctrl+O). A failure is shown as
 * a status message, not only logged.
 */
import { getTransport } from '@/services/transport';
import { getEventBus } from '@/events/EventBus';

const isMac = () =>
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/** Shortcut text for the empty-state buttons ("⌘⇧O" style is avoided: words read better). */
export function openFileShortcut(): string {
  return isMac() ? 'Cmd+Shift+O' : 'Ctrl+Shift+O';
}

export function mountDirectoryShortcut(): string {
  return isMac() ? 'Cmd+O' : 'Ctrl+O';
}

export async function openFileDialog(): Promise<void> {
  try {
    await getTransport().invoke<void>('open_file_dialog');
  } catch (err) {
    console.error('[fileActions] open_file_dialog failed:', err);
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: 'Could not open the file picker. Use File > Open File…',
    });
  }
}

export async function mountDirectoryDialog(): Promise<void> {
  try {
    await getTransport().invoke<void>('open_mount_dialog');
  } catch (err) {
    console.error('[fileActions] open_mount_dialog failed:', err);
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: 'Could not open the folder picker. Use File > Mount Directory…',
    });
  }
}
