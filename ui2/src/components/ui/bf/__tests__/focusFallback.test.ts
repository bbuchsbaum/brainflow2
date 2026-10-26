import { afterEach, describe, expect, it } from 'vitest';
import { focusFallback, focusIsLost } from '../focusFallback';

const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

describe('focusFallback (one helper for controls that remove themselves)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus to the first candidate still in the document when focus fell to <body>', async () => {
    document.body.innerHTML = '<button id="gone">x</button><button id="next" disabled>n</button><input id="field" />';
    const gone = document.getElementById('gone')!;
    gone.focus();
    gone.remove();
    expect(focusIsLost()).toBe(true);
    focusFallback(['#missing', '#next', '#field']);
    await frames();
    expect(document.activeElement).toBe(document.getElementById('field'));
  });

  it('leaves focus alone when it is still somewhere useful', async () => {
    document.body.innerHTML = '<input id="a" /><input id="b" />';
    (document.getElementById('a') as HTMLInputElement).focus();
    focusFallback(['#b']);
    await frames();
    expect(document.activeElement?.id).toBe('a');
  });
});
