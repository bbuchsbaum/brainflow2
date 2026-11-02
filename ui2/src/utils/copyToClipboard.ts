import { getEventBus } from '@/events/EventBus';

/** Copy `text` and say so in the status bar. */
export async function copyToClipboard(text: string, what: string): Promise<void> {
  const notify = (type: 'info' | 'error', message: string) =>
    getEventBus().emit('ui.notification', { type, message, durationMs: 1500 });
  try {
    await navigator.clipboard.writeText(text);
    notify('info', `${what} copied`);
  } catch {
    notify('error', `Could not copy ${what.toLowerCase()}`);
  }
}
