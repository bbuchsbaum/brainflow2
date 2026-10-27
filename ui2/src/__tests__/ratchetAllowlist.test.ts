/**
 * The bf-ratchet allowlist (ui2/eslint.ratchet-allowlist.json) may only shrink.
 * Every entry must still violate each rule it lists when the allowlist is
 * ignored; once a file is clean, this test fails until its entry is removed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const UI2 = resolve(__dirname, '../..');
const { entries } = JSON.parse(
  readFileSync(resolve(UI2, 'eslint.ratchet-allowlist.json'), 'utf8'),
) as {
  entries: Array<{ file: string; rules: string[]; reason: string }>;
};
const KNOWN_RULES = [
  'no-palette-class',
  'no-px-text',
  'no-uppercase-tracking',
  'no-style-hex',
  'no-raw-range',
  'no-handrolled-roles',
  'no-raw-accent',
];

describe('bf-ratchet allowlist', () => {
  it('entries are well formed and unique', () => {
    const files = entries.map((e) => e.file);
    expect(new Set(files).size).toBe(files.length);
    for (const e of entries) {
      expect(existsSync(resolve(UI2, e.file)), `${e.file} does not exist; remove its entry`).toBe(
        true,
      );
      expect(e.reason.trim().length, `${e.file} needs a reason`).toBeGreaterThan(10);
      expect(e.rules.length).toBeGreaterThan(0);
      for (const r of e.rules) expect(KNOWN_RULES, `${e.file}: unknown rule ${r}`).toContain(r);
    }
  });

  it(
    'every entry still violates each rule it lists (shrink-only)',
    { timeout: 60_000 },
    async () => {
      if (entries.length === 0) return;
      process.env.BF_RATCHET_IGNORE_ALLOWLIST = '1';
      try {
        const eslint = new ESLint({ cwd: UI2 });
        const results = await eslint.lintFiles(entries.map((e) => e.file));
        const fired = new Map<string, Set<string>>();
        for (const r of results) {
          const rel = r.filePath.slice(UI2.length + 1);
          const set = fired.get(rel) ?? new Set<string>();
          for (const m of r.messages) {
            if (m.ruleId?.startsWith('bf-ratchet/')) set.add(m.ruleId.slice('bf-ratchet/'.length));
          }
          fired.set(rel, set);
        }
        const stale = entries.flatMap((e) =>
          e.rules
            .filter((rule) => !fired.get(e.file)?.has(rule))
            .map((rule) => `${e.file} → ${rule}`),
        );
        expect(
          stale,
          'allowlist entries that no longer fire; remove them from eslint.ratchet-allowlist.json',
        ).toEqual([]);
      } finally {
        delete process.env.BF_RATCHET_IGNORE_ALLOWLIST;
      }
    },
  );
});
