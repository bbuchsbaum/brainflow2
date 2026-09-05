import { describe, expect, it } from 'vitest';
import { formatTauriError, toError } from '../formatTauriError';

describe('formatTauriError', () => {
  it('returns raw string errors', () => {
    expect(formatTauriError('plain error')).toBe('plain error');
  });

  it('returns Error.message for Error instances', () => {
    expect(formatTauriError(new Error('boom'))).toBe('boom');
  });

  it('returns flat details fields from object payloads', () => {
    expect(formatTauriError({ code: 500, details: 'flat details' })).toBe('flat details');
  });

  it('unwraps nested tauri enum payloads', () => {
    const nested = {
      Input: {
        code: 8224,
        details: "SSH authentication denied for user 'Brad'",
      },
    };
    expect(formatTauriError(nested)).toBe("SSH authentication denied for user 'Brad'");
  });

  it('falls back to JSON when no message-like fields exist', () => {
    const payload = { foo: 'bar', n: 1 };
    expect(formatTauriError(payload)).toBe(JSON.stringify(payload));
  });
});

describe('toError', () => {
  it('preserves Error identity and the original structured cause', () => {
    const original = new Error('failure');
    expect(toError(original)).toBe(original);
    const payload = { Internal: { code: 5099, details: 'GPU upload task panicked' } };
    expect(toError(payload).message).toBe('GPU upload task panicked');
    expect(toError(payload).cause).toBe(payload);
    expect(toError(undefined).message).toBe('Unknown error');
  });
});
