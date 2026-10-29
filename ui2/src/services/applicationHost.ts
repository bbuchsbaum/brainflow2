import {
  getConfiguredTransport,
  getTransport,
  setTransport,
  type BackendTransport,
} from './transport';

/** Select once, before importing App or constructing any singleton service. */
export async function selectApplicationHost(): Promise<BackendTransport> {
  const configured = getConfiguredTransport();
  if (configured) return configured;
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__)
    return getTransport();
  const { WorkspaceBrowserTransport } = await import('./browser/WorkspaceBrowserTransport');
  const transport = new WorkspaceBrowserTransport();
  setTransport(transport);
  try {
    await transport.invoke('init_render_loop');
  } catch (error) {
    transport.dispose();
    throw error;
  }
  window.addEventListener('pagehide', () => transport.dispose(), { once: true });
  return transport;
}
export function isBrowserHost(): boolean {
  return getTransport().host === 'browser';
}
