import type { ComponentItem, ContentItem, GoldenLayout } from 'golden-layout';
import { tabWorkspaceId } from './workspaceTabSync';
import { workspaceCloseIsGuarded } from '@/services/workspaceCloseGuards';

/** Intercept cancellable DOM affordances before GoldenLayout begins removal. */
export function installWorkspaceCloseCapture(
  layout: GoldenLayout,
  root: HTMLElement,
  requestClose: (workspaceId: string) => Promise<boolean>,
): () => void {
  const tabs = new WeakMap<HTMLElement, string>();
  const onCreated = (tab: unknown) => {
    if (!tab || typeof tab !== 'object' || !('componentItem' in tab) || !('element' in tab) || !(tab.element instanceof HTMLElement)) return;
    const id = tabWorkspaceId(tab.componentItem as ComponentItem);
    if (id) tabs.set(tab.element, id);
  };
  layout.on('tabCreated', onCreated);
  const workspaceAt = (target: EventTarget | null): string | null => {
    const element = target instanceof HTMLElement ? target : null;
    const tab = element?.closest('.lm_tab') as HTMLElement | null;
    return tab ? tabs.get(tab) ?? null : null;
  };
  const guardedStack = (target: EventTarget | null): boolean => {
    const element = target instanceof HTMLElement ? target : null;
    if (!element?.closest('.lm_close')) return false;
    const stack = element.closest('.lm_stack') as HTMLElement | null;
    if (!stack) return false;
    const content = Array.from(layout.rootItem?.contentItems ?? []);
    const visit = (item: ContentItem): boolean => {
      if (item.type === 'stack' && item.element === stack) {
        return item.contentItems.some((child: ContentItem) => {
          const id = child.type === 'component' ? tabWorkspaceId(child as ComponentItem) : null;
          return Boolean(id && workspaceCloseIsGuarded(id));
        });
      }
      return item.contentItems?.some(visit) ?? false;
    };
    if (!content.some(visit)) return false;
    getEventTargetTitle(element)?.setAttribute('title', 'Close session tabs individually');
    return true;
  };
  const intercept = (event: Event) => {
    if (guardedStack(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    const id = workspaceAt(event.target);
    const isClose = (event.target as HTMLElement | null)?.closest('.lm_close_tab');
    const middle = event instanceof MouseEvent && event.button === 1;
    if (!id || (!isClose && !middle)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void requestClose(id);
  };
  root.addEventListener('click', intercept, true);
  root.addEventListener('auxclick', intercept, true);
  root.addEventListener('touchstart', intercept, true);
  return () => {
    root.removeEventListener('click', intercept, true);
    root.removeEventListener('auxclick', intercept, true);
    root.removeEventListener('touchstart', intercept, true);
    layout.off('tabCreated', onCreated);
  };
}

function getEventTargetTitle(element: HTMLElement): HTMLElement | null {
  return element.closest('.lm_close') as HTMLElement | null;
}
