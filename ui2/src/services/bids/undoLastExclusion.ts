import { getEventBus } from '@/events/EventBus';
import { useBidsStore } from '@/stores/bidsStore';

/** Undo from any control. A failed undo leaves the rows on disk, so the user must hear of it. */
export async function undoLastExclusion(): Promise<void> {
  try {
    await useBidsStore.getState().undoExclusion();
  } catch (error) {
    getEventBus().emit('ui.notification', {
      type: 'error',
      message: `Exclusion not undone: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
