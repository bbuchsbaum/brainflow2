import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReadmeText } from '../ReadmeText';
import * as safeMarkdown from '../safeMarkdown';
import { INLINE_PARSE_LIMIT, parseInline, parseMarkdown } from '../safeMarkdown';

describe('markdown subset parser', () => {
  it('parses headings, paragraphs, lists and code blocks', () => {
    const blocks = parseMarkdown(
      [
        '# Recognition phase model',
        '',
        'Single-trial betas were estimated',
        'for each probe.',
        '',
        '- `same_item` probes that repeat',
        '- diff_item probes',
        '',
        '1. first',
        '2. second',
        '',
        '```',
        'sub-<id>/maps/<contrast>.nii.gz',
        '```',
        '',
        'Setext title',
        '------------',
      ].join('\n'),
    );
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'code',
      'heading',
    ]);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Single-trial betas were estimated for each probe.' }],
    });
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true, start: 1 });
    expect(blocks[4]).toEqual({ type: 'code', text: 'sub-<id>/maps/<contrast>.nii.gz' });
    expect(blocks[5]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('leaves underscores inside names alone and reads emphasis elsewhere', () => {
    expect(parseInline('sub-01_task-rest_bold and same_item')).toEqual([
      { type: 'text', text: 'sub-01_task-rest_bold and same_item' },
    ]);
    expect(parseInline('a **bold** and *soft* word')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'soft' }] },
      { type: 'text', text: ' word' },
    ]);
  });

  it('turns links and images into data, never markup', () => {
    expect(parseInline('see [the paper](https://example.org/p "t") and ![a brain](x.png)')).toEqual(
      [
        { type: 'text', text: 'see ' },
        { type: 'link', text: 'the paper', url: 'https://example.org/p' },
        { type: 'text', text: ' and ' },
        { type: 'image', alt: 'a brain' },
      ],
    );
  });

  it('keeps an unclosed fence as code to the end of the text', () => {
    expect(parseMarkdown('```\nopen ended')).toEqual([{ type: 'code', text: 'open ended' }]);
  });
});

describe('ReadmeText', () => {
  const hostile = [
    '# Title',
    '',
    '<script>window.__pwned = true</script>',
    '',
    'An image tag: <img src="x" onerror="window.__pwned = true">',
    '',
    'A [link](javascript:window.__pwned=true) and ![remote](https://example.org/track.png).',
    '',
    '<a href="javascript:void(0)" onclick="window.__pwned = true">click</a>',
    '',
    '<https://example.org/auto>',
  ].join('\n');

  it('renders hostile Markdown as inert text', () => {
    const { container } = render(<ReadmeText fileName="README.md" text={hostile} />);
    // No element a README could use to run script, fetch, or navigate.
    expect(
      container.querySelector('script, img, a, iframe, object, embed, style, link'),
    ).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute.startsWith('on')).toBe(false);
        expect(['href', 'src', 'srcset', 'style']).not.toContain(attribute);
      }
    }
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // What was typed stays readable.
    expect(container.textContent).toContain('<script>window.__pwned = true</script>');
    expect(container.textContent).toContain('<img src="x" onerror="window.__pwned = true">');
    expect(container.textContent).toContain('link (javascript:window.__pwned=true)');
    expect(container.textContent).toContain('[Image: remote]');
    expect(container.textContent).not.toContain('track.png');
    expect(container.textContent).toContain('https://example.org/auto');
  });

  it('maps README headings to modest levels below the card title', () => {
    render(<ReadmeText fileName="README.md" text={'# One\n\n## Two\n\n### Three'} />);
    expect(screen.getByRole('heading', { name: 'One' }).tagName).toBe('H3');
    expect(screen.getByRole('heading', { name: 'Two' }).tagName).toBe('H4');
    expect(screen.getByRole('heading', { name: 'Three' }).tagName).toBe('H5');
    expect(screen.getByRole('heading', { name: 'One' }).className).toContain('text-bf-md');
  });

  it.each(['README.rst', 'README.txt', 'CHANGES.log'])(
    'shows %s as wrapped preformatted text, not Markdown',
    (fileName) => {
      const text = 'Title\n=====\n\n* not a list\n<b>raw</b>';
      const { container } = render(<ReadmeText fileName={fileName} text={text} />);
      const pre = container.querySelector('pre[data-readme-format="plain"]');
      expect(pre?.textContent).toBe(text);
      expect(pre?.className).toContain('whitespace-pre-wrap');
      expect(container.querySelector('h3, ul, b')).toBeNull();
    },
  );
});

/**
 * A README may be 256 KiB and is parsed on the UI thread. Each of these took
 * between half a second and two minutes when the inline scans were quadratic.
 */
describe('hostile README sizes', () => {
  const SIZE = 256 * 1024;
  const paragraphs = (unit: string, each: number) => {
    const paragraph = unit.repeat(Math.floor(each / unit.length));
    return `${paragraph}\n\n`.repeat(Math.floor(SIZE / (paragraph.length + 2)));
  };
  const cases: Array<[string, string]> = [
    ['one line of [', '['.repeat(SIZE)],
    ['one line of "*a "', '*a '.repeat(Math.floor(SIZE / 3))],
    ['one line of "_a "', '_a '.repeat(Math.floor(SIZE / 3))],
    ['one line of ![', '!['.repeat(SIZE / 2)],
    ['a heading with a long run of spaces', `# a${' '.repeat(SIZE)}b`],
    // Paragraphs just under the plain-text limit, so the inline scans run.
    ['paragraphs of [', paragraphs('[', INLINE_PARSE_LIMIT - 96)],
    ['paragraphs of "*a "', paragraphs('*a ', INLINE_PARSE_LIMIT - 96)],
    ['paragraphs of "__a "', paragraphs('__a ', INLINE_PARSE_LIMIT - 96)],
    ['paragraphs of "`a ``b "', paragraphs('`a ``b ```c ', INLINE_PARSE_LIMIT - 96)],
    ['paragraphs of unclosed destinations', paragraphs('[a](', INLINE_PARSE_LIMIT - 96)],
    [
      'paragraphs of nested labels',
      `${'['.repeat(900)}a${'](u)'.repeat(700)}\n\n`.repeat(Math.floor(SIZE / 3703)),
    ],
    [
      'headings with long runs of spaces',
      `# a${' '.repeat(INLINE_PARSE_LIMIT - 96)}b\n`.repeat(Math.floor(SIZE / INLINE_PARSE_LIMIT)),
    ],
  ];

  it.each(cases)('parses 256 KiB of %s in well under a second', (_name, text) => {
    expect(text.length).toBeGreaterThan(SIZE * 0.9);
    const started = performance.now();
    const blocks = parseMarkdown(text);
    const elapsed = performance.now() - started;
    expect(blocks.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(400);
  });

  it('shows an overlong paragraph as typed, and still marks up the ones around it', () => {
    const long = `**${'word '.repeat(INLINE_PARSE_LIMIT / 4)}**`;
    const blocks = parseMarkdown(`**short**\n\n${long}\n\n*after*`);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'strong', children: [{ type: 'text', text: 'short' }] }],
    });
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: long }] });
    expect(blocks[2]).toEqual({
      type: 'paragraph',
      children: [{ type: 'em', children: [{ type: 'text', text: 'after' }] }],
    });
  });

  it('still reads links, titles and nested emphasis as before', () => {
    expect(parseInline('[a [b] c](http://x.y "t") and ![alt](p.png \'t\')')).toEqual([
      { type: 'link', text: 'a [b] c', url: 'http://x.y' },
      { type: 'text', text: ' and ' },
      { type: 'image', alt: 'alt' },
    ]);
    expect(parseInline('[a](<http://x.y> (note)) [b](c(d)e) [no](open')).toEqual([
      { type: 'link', text: 'a', url: 'http://x.y' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'b', url: 'c(d)e' },
      { type: 'text', text: ' [no](open' },
    ]);
    expect(parseInline('**a *b* c** *open and `code`')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'em', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
      { type: 'text', text: ' *open and ' },
      { type: 'code', text: 'code' },
    ]);
    expect(parseMarkdown('## Title ##\n\n# #\n\n#  spaced   out  ')).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Title' }] },
      { type: 'heading', level: 1, children: [{ type: 'text', text: '#' }] },
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'spaced   out' }] },
    ]);
  });
});

describe('ReadmeText rendering', () => {
  it('parses a README once, however often its card re-renders', () => {
    const spy = vi.spyOn(safeMarkdown, 'parseMarkdown');
    try {
      const text = '# Title\n\nBody';
      const { rerender } = render(<ReadmeText fileName="README.md" text={text} />);
      const calls = spy.mock.calls.length;
      expect(calls).toBe(1);
      rerender(<ReadmeText fileName="README.md" text={text} className="x" />);
      rerender(<ReadmeText fileName="README.md" text={text} />);
      expect(spy.mock.calls.length).toBe(calls);
    } finally {
      spy.mockRestore();
    }
  });
});
