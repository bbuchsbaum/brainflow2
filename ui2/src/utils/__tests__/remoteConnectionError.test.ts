import { describe, expect, it } from 'vitest';
import { toError } from '../formatTauriError';
import {
  connectionLostTitle,
  isRemoteConnectionLost,
  plainRemoteReason,
} from '../remoteConnectionError';

describe('isRemoteConnectionLost', () => {
  it.each([
    // map_remotely_error: the failed operation's code, remotely's text.
    ['a dropped session on a download', { Io: { code: 8218, details: 'SSH error: SSH session disconnected' } }],
    ['a dropped session on a stat', { Io: { code: 8243, details: 'SSH error: SSH session disconnected' } }],
    ['a dropped session on a listing', { Io: { code: 8216, details: 'SSH error: SSH session disconnected' } }],
    [
      'a path under the cache with no active mount (8232)',
      { Input: { code: 8232, details: "Remote mount is not active for '/cache/x'. Reconnect the remote folder and try again." } },
    ],
    ['a source fetch with no session (8252)', { Io: { code: 8252, details: 'The remote folder is not connected. Reconnect to continue.' } }],
    [
      'a card read on a replaced mount (8262)',
      { Io: { code: 8262, details: 'Remote mount brad@host:/scratch was unmounted or replaced while this folder was being read; reconnect the remote folder and try again.' } },
    ],
    ['a transfer whose mount was unmounted', { Io: { code: 8218, details: 'Remote mount has been unmounted' } }],
    ['a transfer whose mount closed', { Io: { code: 8218, details: 'Remote mount closed' } }],
  ])('recognises %s', (_name, error) => {
    expect(isRemoteConnectionLost(error)).toBe(true);
  });

  it('recognises a dropped session by its code, whatever the transport called it', () => {
    for (const details of [
      'SSH error: SSH session disconnected',
      'SSH error: SSH channel error: SFTP transport error: session closed',
      "filesystem operation 'stat' on '/scratch/x': SSH error: SSH channel error: SFTP transport error: Broken pipe (os error 32)",
      'SSH error: SSH protocol error: Connection closed by the remote side',
    ]) {
      expect(isRemoteConnectionLost({ Io: { code: 8266, details } })).toBe(true);
      expect(isRemoteConnectionLost(toError({ Io: { code: 8266, details } }))).toBe(true);
    }
    // The same words under an operation's own code are not enough: only the
    // exact sentences are matched as text.
    expect(
      isRemoteConnectionLost({
        Io: { code: 8243, details: 'SSH error: SSH channel error: SFTP transport error: session closed' },
      }),
    ).toBe(false);
  });

  it('recognises the failure once it is only text', () => {
    expect(isRemoteConnectionLost('SSH error: SSH session disconnected')).toBe(true);
    expect(isRemoteConnectionLost(new Error('SSH error: SSH session disconnected'))).toBe(true);
    expect(
      isRemoteConnectionLost(
        new Error("Remote mount is not active for '/cache/x'. Reconnect the remote folder and try again."),
      ),
    ).toBe(true);
    expect(
      isRemoteConnectionLost(new Error('The remote folder is not connected. Reconnect to continue.')),
    ).toBe(true);
  });

  it('reads the code through the Error the load queue keeps', () => {
    const failure = toError({ Input: { code: 8232, details: 'anything' } });
    expect(isRemoteConnectionLost(failure)).toBe(true);
    const wrapped = new Error('Failed to load member', {
      cause: { Io: { code: 8218, details: 'SSH error: SSH session disconnected' } },
    });
    expect(isRemoteConnectionLost(wrapped)).toBe(true);
  });

  it.each([
    ['a missing remote file', { Io: { code: 8243, details: 'Filesystem error: file not found: /scratch/x.nii.gz' } }],
    ['a refused login', { Input: { code: 8221, details: "SSH authentication denied: SSH error: authentication denied for user 'brad'" } }],
    ['a transient channel error', { Io: { code: 8216, details: 'SSH error: SSH channel error: Channel send error' } }],
    ['a stalled download', { Io: { code: 8218, details: 'Remote download stalled without receiving data' } }],
    ['a cancelled download', { Io: { code: 8218, details: 'Remote download cancelled' } }],
    ['a connect timeout', { Io: { code: 8221, details: 'SSH connection timed out after 45s while connecting/authenticating.' } }],
    ['an unreadable local file', { Io: { code: 1001, details: 'File not found: /data/x.nii.gz' } }],
    ['a decode failure', { Loader: { code: 2001, details: 'not a NIfTI file' } }],
    ['a GPU refusal', new Error('Maximum texture limit 13 reached')],
    ['nothing', null],
    ['an empty message', ''],
  ])('leaves %s alone', (_name, error) => {
    expect(isRemoteConnectionLost(error)).toBe(false);
  });
});

describe('plainRemoteReason', () => {
  it('drops the transport prefix and keeps the cause', () => {
    expect(plainRemoteReason('SSH error: SSH channel error: Channel send error')).toBe(
      'SSH channel error: Channel send error',
    );
    expect(plainRemoteReason('Filesystem error: file not found: /scratch/x.nii.gz')).toBe(
      'file not found: /scratch/x.nii.gz',
    );
    expect(plainRemoteReason('not a NIfTI file')).toBe('not a NIfTI file');
    expect(plainRemoteReason('SSH error: ')).toBe('SSH error:');
  });
});

describe('connectionLostTitle', () => {
  it('names the host when it is known', () => {
    expect(connectionLostTitle('trillium.alliancecan.ca')).toBe(
      'The connection to trillium.alliancecan.ca was lost',
    );
    expect(connectionLostTitle(null)).toBe('The connection to the remote folder was lost');
  });
});
