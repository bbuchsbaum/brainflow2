/**
 * Which host the app runs in, for the manifests' `hosts` and
 * `requires.hostCapabilities`. Read lazily: the transport is chosen before App
 * loads (services/applicationHost.ts). Without a transport (unit tests) the
 * desktop defaults apply, as in `getHostCapabilities()`.
 */

import { getConfiguredTransport, getHostCapabilities } from '@/services/transport';
import type { HostCapability, ModuleHostKind } from './api';

export function currentModuleHost(): ModuleHostKind {
  try {
    return getConfiguredTransport()?.host === 'browser' ? 'browser' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function currentHostCapabilities(): Partial<Record<HostCapability, boolean>> {
  try {
    return getHostCapabilities();
  } catch {
    return { nativePaths: true, remoteMounts: true, externalProcesses: true };
  }
}
