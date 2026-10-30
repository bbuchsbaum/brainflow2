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
