import { describe, expect, it } from 'vitest';
import { formatShortcut, rankCommands, scoreCommand } from '../commandPaletteMatch';

const commands = [
  { id: 'mount', title: 'Mount Directory…', keywords: ['files', 'mount', 'directory'], group: 'File' },
  { id: 'header', title: 'Image Header…', subtitle: 'The selected layer’s NIfTI header.', group: 'Info' },
  { id: 'xsettings', title: 'Crosshair Settings…', keywords: ['crosshair', 'snap'], group: 'Navigation' },
  { id: 'snap', title: 'Toggle Snap to Voxel', keywords: ['snap', 'voxel', 'crosshair'] },
  { id: 'shortcuts', title: 'Show Keyboard Shortcuts', keywords: ['help', 'shortcuts'] },
  { id: 'reset', title: 'Reset Layout', keywords: ['layout', 'reset', 'panels'], group: 'Layouts' },
];
const ids = (query: string) => rankCommands(commands, query).map((c) => c.id);

describe('rankCommands', () => {
  it('keeps every command, in order, for an empty query', () => {
    expect(ids('')).toEqual(commands.map((c) => c.id));
    expect(ids('   ')).toEqual(commands.map((c) => c.id));
  });

  it('finds "hdr" by subsequence and "xhair" by alias (QA 2026-10-29 §15)', () => {
    expect(ids('hdr')[0]).toBe('header');
    const xhair = ids('xhair');
    expect(xhair[0]).toBe('xsettings');
    expect(xhair).toContain('snap');
  });

  it('ranks a title prefix above a keyword or later-word match', () => {
    expect(ids('snap')[0]).toBe('snap');
    expect(ids('cross')[0]).toBe('xsettings');
  });

  it('requires every token to match', () => {
    expect(ids('reset layout')).toEqual(['reset']);
    expect(ids('reset header')).toEqual([]);
  });

  it('does not match unrelated text', () => {
    expect(ids('zzz')).toEqual([]);
    expect(scoreCommand(commands[0], 'surface')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(ids('IMAGE')[0]).toBe('header');
  });
});

describe('rankCommands is not loose (QA 2026-10-30 F30)', () => {
  const app = [
    { id: 'inspector', title: 'Show Inspector', keywords: ['panel', 'inspector'] },
    { id: 'panels', title: 'Layout: Orthogonal Panels', keywords: ['layout', 'orthogonal', 'panels'] },
    { id: 'xsettings', title: 'Crosshair Settings…', keywords: ['crosshair', 'settings', 'snap'] },
    { id: 'snap', title: 'Toggle Snap to Voxel', keywords: ['snap', 'voxel'] },
    { id: 'aseg', title: 'Load Atlas: ASEG Subcortical', keywords: ['atlas', 'aseg'] },
  ];
  const appIds = (q: string) => rankCommands(app, q).map((c) => c.id);

  it('drops scattered subsequences', () => {
    expect(appIds('atlas')).toEqual(['aseg']);
    expect(appIds('aseg')).toEqual(['aseg']);
    expect(scoreCommand(app[1], 'atlas')).toBe(0);
    expect(scoreCommand(app[2], 'aseg')).toBe(0);
  });

  it('keeps word-prefix runs (acronyms, abbreviated words)', () => {
    expect(appIds('tsv')).toEqual(['snap']);
    expect(appIds('orthpan')[0]).toBe('panels');
    expect(appIds('xset')).toEqual([]);
  });

  it('ranks a substring above word-prefix runs', () => {
    const pair = [
      { id: 'runs', title: 'Set Elevation' },
      { id: 'sub', title: 'Reset' },
    ];
    expect(rankCommands(pair, 'se').map((c) => c.id)).toEqual(['runs', 'sub']);
    expect(rankCommands(pair, 'sel').map((c) => c.id)).toEqual(['runs']);
    expect(rankCommands(pair, 'eset').map((c) => c.id)).toEqual(['sub']);
  });
});

describe('rankCommands keeps abbreviations (F30 review)', () => {
  const app = [
    { id: 'kbd', title: 'Show Keyboard Shortcuts', keywords: ['help', 'shortcuts'] },
    { id: 'rm', title: 'Remove Selected Layer', keywords: ['layer', 'delete'] },
    { id: 'ns', title: 'Toggle Neurosynth Lookup', keywords: ['neurosynth', 'terms'] },
    { id: 'export', title: 'Export View as Image…', keywords: ['export', 'png'] },
    { id: 'tmpl', title: 'Load Template…', keywords: ['template', 'mni'] },
    { id: 'cmap', title: 'Layer Colormap', keywords: ['colormap', 'palette'] },
    { id: 'xsettings', title: 'Crosshair Settings…', keywords: ['crosshair', 'settings', 'snap'] },
    { id: 'panels', title: 'Layout: Orthogonal Panels', keywords: ['layout', 'orthogonal', 'panels'] },
  ];
  const first = (q: string) => rankCommands(app, q)[0]?.id;

  it.each([
    ['kb', 'kbd'],
    ['rm', 'rm'],
    ['nsynth', 'ns'],
    ['expimg', 'export'],
    ['tmpl', 'tmpl'],
    ['colmap', 'cmap'],
    ['xhset', 'xsettings'],
  ])('"%s" finds %s', (query, id) => {
    expect(first(query)).toBe(id);
  });

  it('still rejects scattered matches', () => {
    expect(scoreCommand(app[7], 'atlas')).toBe(0);
    expect(scoreCommand(app[6], 'aseg')).toBe(0);
  });

  it('scores an abbreviated word below word-prefix runs', () => {
    const pair = [
      { id: 'abbrev', title: 'Keyboard' },
      { id: 'runs', title: 'Key Bindings' },
    ];
    expect(rankCommands(pair, 'kb').map((c) => c.id)).toEqual(['runs', 'abbrev']);
  });
});

describe('formatShortcut', () => {
  it('uses macOS glyphs in the standard modifier order', () => {
    expect(formatShortcut('Cmd/Ctrl+O', true)).toBe('⌘O');
    expect(formatShortcut('Cmd/Ctrl+Shift+E', true)).toBe('⇧⌘E');
    expect(formatShortcut('Cmd+Alt+Ctrl+k', true)).toBe('⌃⌥⌘K');
  });

  it('spells out Ctrl elsewhere', () => {
    expect(formatShortcut('Cmd/Ctrl+O', false)).toBe('Ctrl+O');
    expect(formatShortcut('Cmd/Ctrl+Shift+E', false)).toBe('Ctrl+Shift+E');
  });

  it('passes single keys through', () => {
    expect(formatShortcut('G', true)).toBe('G');
    expect(formatShortcut('?', true)).toBe('?');
  });
});
