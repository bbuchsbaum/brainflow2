import { Button, type ButtonProps } from '@/components/ui/bf';
import { useRemoteReconnect } from '@/hooks/useRemoteReconnect';

interface RemoteReconnectButtonProps {
  /** A local path under the remote mount's cache root, or the mount's id. */
  path: string | null | undefined;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  testId?: string;
}

/**
 * "Reconnect" for the remote mount that owns `path`: signs in again through
 * `reconnectRemoteMount` and reads "Reconnecting…" while any reconnect of
 * that mount runs. Renders nothing for a path no remote mount owns. What
 * failed is retried by its own surface (`useRecoverOnReconnect`), not here.
 */
export function RemoteReconnectButton({
  path,
  variant = 'secondary',
  size = 'sm',
  className,
  testId = 'remote-reconnect',
}: RemoteReconnectButtonProps) {
  const remote = useRemoteReconnect(path);
  if (!remote.root) return null;
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={remote.reconnecting}
      aria-busy={remote.reconnecting || undefined}
      title={remote.failure ?? undefined}
      data-testid={testId}
      onClick={() => void remote.reconnect()}
    >
      {remote.reconnecting ? 'Reconnecting…' : 'Reconnect'}
    </Button>
  );
}
