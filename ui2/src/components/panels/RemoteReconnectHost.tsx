import { useEffect, useRef } from 'react';
import { RemoteMountDialog } from './RemoteMountDialog';
import { settleRemoteReconnectPrompt } from '@/services/RemoteReconnectService';
import type { ConnectedRemoteMount } from '@/services/RemoteMountService';
import { useRemoteConnectionStore } from '@/stores/remoteConnectionStore';

/**
 * Shows the sign-in for a reconnect asked for anywhere in the app
 * (`reconnectRemoteMount`): the existing remote mount dialog, opened on the
 * folder's saved profile and connecting at once, so it only asks for what SSH
 * asks (a host key, a Duo prompt). Mounted once in `App`.
 */
export function RemoteReconnectHost() {
  const request = useRemoteConnectionStore((state) => state.requests[0] ?? null);
  const mounted = useRef<ConnectedRemoteMount | null>(null);

  useEffect(() => {
    useRemoteConnectionStore.setState((state) => ({ hosts: state.hosts + 1 }));
    return () => {
      useRemoteConnectionStore.setState((state) => ({ hosts: Math.max(0, state.hosts - 1) }));
    };
  }, []);

  if (!request) return null;
  return (
    <RemoteMountDialog
      // One dialog per request: a queued reconnect opens on its own folder.
      key={request.root}
      isOpen
      initialTarget={request.target}
      autoConnect
      onMounted={(mount) => {
        mounted.current = mount;
      }}
      onClose={() => {
        const mount = mounted.current;
        mounted.current = null;
        settleRemoteReconnectPrompt(request.root, mount);
      }}
    />
  );
}
