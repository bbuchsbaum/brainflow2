import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { isViewerKeyTarget, navigationKeyTarget } from '../viewerKeyTarget';

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

  describe('a click on text that takes no focus (QA 2026-10-30 F23)', () => {
    it('aims the keys at the Log line clicked, not at the viewer', () => {
      const get = mount(
        '<div id="log" style="overflow-y:auto"><div id="line">12:00 info Loaded</div></div><div data-view-id="axial" id="v"><canvas id="c"></canvas></div>',
      );
      Object.defineProperty(get('log'), 'scrollHeight', { value: 500 });
      Object.defineProperty(get('log'), 'clientHeight', { value: 100 });
      fireEvent.pointerDown(get('line'));
      expect(document.activeElement).toBe(document.body);
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(false);

      // A click back in the view gives the keys back to the viewer.
      fireEvent.pointerDown(get('c'));
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(true);
    });

    it('a press on a toolbar button (not focused by WebKit) leaves the keys to the viewer', () => {
      const get = mount('<header><button id="b">b</button></header>');
      fireEvent.pointerDown(get('b'));
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(true);
    });

    it('a press on a segmented control or tab in a scrolling panel leaves the keys to the viewer (review 1)', () => {
      const get = mount(
        '<div id="panel" style="overflow-y:auto">' +
          '<div role="radiogroup"><button role="radio" id="ortho">Ortho</button><button role="radio" id="mosaic">Mosaic</button></div>' +
          '<div role="tablist"><button role="tab" id="tab">Plot</button></div>' +
        '</div>',
      );
      Object.defineProperty(get('panel'), 'scrollHeight', { value: 500 });
      Object.defineProperty(get('panel'), 'clientHeight', { value: 100 });
      // WKWebView: the pressed pill does not take focus.
      fireEvent.pointerDown(get('mosaic'));
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(true);
      fireEvent.pointerDown(get('tab'));
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(true);
      // Chromium focuses it: SegmentedControl then ignores arrows, so the viewer takes them.
      fireEvent.pointerDown(get('ortho'));
      get('ortho').focus();
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(true);
    });

    it('a segmented control reached with Tab keeps its arrows', () => {
      const get = mount(
        '<div role="radiogroup"><button role="radio" id="ortho">Ortho</button></div><div id="elsewhere">x</div>',
      );
      fireEvent.pointerDown(get('elsewhere'));
      get('ortho').focus();
      expect(isViewerKeyTarget(navigationKeyTarget())).toBe(false);
    });

    it('prefers the focused element over the last click', () => {
      const get = mount('<div role="tree"><div id="line"></div></div><button id="b">b</button>');
      fireEvent.pointerDown(get('line'));
      get('b').focus();
      expect(navigationKeyTarget()).toBe(get('b'));
    });
  });
});
