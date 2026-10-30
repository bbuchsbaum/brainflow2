import { describe, expect, it } from 'vitest';
import { formatTauriError, loadFailureMessage, toError } from '../formatTauriError';

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

describe('loadFailureMessage', () => {
  it('collapses a repeated "Failed to load" prefix from the bridge', () => {
    const bridge = { Loader: { code: 1003, details: 'Failed to load file /data/x.nii: not a NIfTI file: the file is empty' } };
    expect(loadFailureMessage('x.nii', bridge)).toBe(
      'Failed to load x.nii: not a NIfTI file: the file is empty',
    );
    expect(loadFailureMessage('x.nii', new Error('Failed to load file: Failed to load x.nii: truncated'))).toBe(
      'Failed to load x.nii: truncated',
    );
  });

  it('leaves other details alone', () => {
    expect(loadFailureMessage('surface lh.pial', 'GIfTI parse error: bad XML')).toBe(
      'Failed to load surface lh.pial: GIfTI parse error: bad XML',
    );
    expect(loadFailureMessage('x.nii', 'Failed to load')).toBe('Failed to load x.nii: Failed to load');
    expect(loadFailureMessage('x.nii', '')).toBe('Failed to load x.nii');
  });
});
