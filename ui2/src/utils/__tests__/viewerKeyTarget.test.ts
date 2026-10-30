import { afterEach, describe, expect, it } from 'vitest';
import { isViewerKeyTarget } from '../viewerKeyTarget';

describe('isViewerKeyTarget (Up/Down/PageUp/PageDown scoping)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
    return (id: string) => document.getElementById(id)!;
  };

  it('is the viewer when nothing in particular has focus', () => {
    expect(isViewerKeyTarget(null)).toBe(true);
    expect(isViewerKeyTarget(document.body)).toBe(true);
  });

  it('is the viewer inside a slice view', () => {
    const get = mount('<div data-view-id="axial" tabindex="-1" id="v"><span id="inner"></span></div>');
    expect(isViewerKeyTarget(get('v'))).toBe(true);
    expect(isViewerKeyTarget(get('inner'))).toBe(true);
  });

  it.each(['tree', 'listbox', 'grid', 'log', 'table'])('is not the viewer inside role=%s', (role) => {
    const get = mount(`<div role="${role}"><div tabindex="0" id="t">x</div></div>`);
    expect(isViewerKeyTarget(get('t'))).toBe(false);
  });

  it('is not the viewer inside a scrollable panel', () => {
    const get = mount('<div id="panel" style="overflow-y:auto"><div tabindex="0" id="t">x</div></div>');
    const panel = get('panel');
    Object.defineProperty(panel, 'scrollHeight', { value: 500 });
    Object.defineProperty(panel, 'clientHeight', { value: 100 });
    expect(isViewerKeyTarget(get('t'))).toBe(false);
  });

  it('is not the viewer on other chrome (a toolbar button)', () => {
    const get = mount('<header><button id="b">b</button></header>');
    expect(isViewerKeyTarget(get('b'))).toBe(false);
  });
});
