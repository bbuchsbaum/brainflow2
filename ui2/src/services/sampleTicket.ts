import type { BackendTransport } from '@/services/transport';
import { tauriErrorCode } from '@/utils/formatTauriError';

/**
 * The longest ticket the backend admits (population_sampling.rs,
 * MAX_LIFETIME_MS). A ticket cannot be renewed, and the backend ends a
 * ticketed command itself at the deadline.
 */
export const SAMPLE_TICKET_LIFETIME_MS = 120_000;

/** Bridge code of "Population sampling canceled or expired." */
export const TICKET_ENDED_CODE = 2026;

/** A ticketed command the backend stopped at its ticket's deadline. */
export class TicketExpiredError extends Error {
  constructor() {
    super('The ticket expired before the command finished.');
    this.name = 'TicketExpiredError';
  }
}

/**
 * Run `command` under a cancellation ticket (the population `SampleTicket`):
 * aborting `controller` stops the backend's work, not only the wait for it.
 * Same protocol as `SetIngestionService`'s folder previews. A command the
 * backend ended at the deadline rejects with {@link TicketExpiredError}; one
 * the caller aborted rejects with the bridge's own 2026 error.
 */
export async function invokeWithSampleTicket<T>(
  transport: BackendTransport,
  command: string,
  args: Record<string, unknown>,
  controller: AbortController,
  now: () => number = Date.now,
): Promise<T> {
  const ticket = {
    id: crypto.randomUUID(),
    expiresAtMs: now() + SAMPLE_TICKET_LIFETIME_MS,
  };
  const cancel = () => {
    void transport.invoke('cancel_population_sample', { ticket }).catch(() => {});
  };
  // Aborted before the command was sent: the backend keeps the tombstone and
  // refuses to start it.
  if (controller.signal.aborted) cancel();
  else controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await transport.invoke<T>(command, { ...args, ticket });
  } catch (error) {
    if (!controller.signal.aborted && tauriErrorCode(error) === TICKET_ENDED_CODE) {
      throw new TicketExpiredError();
    }
    throw error;
  } finally {
    controller.signal.removeEventListener('abort', cancel);
  }
}
