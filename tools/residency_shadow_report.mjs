#!/usr/bin/env node
// Tabulate the residency shadow comparison (R5b; docs/plans/gpu-residency-r5-plan-2026-11.md §4).
//
// Reads app logs (files given as arguments, or stdin) and finds the JSON lines
// the backend logs on tracing target `residency.shadow`: one per eviction
// episode ({"ep":..,"verdict":..}) and one per draw-cap mismatch
// ({"drawcap":..,"verdict":"drawcap_mismatch"}). Prints the verdict counts and
// whether the pass bar holds: at least 50 episodes, no `unsafe`,
// `drawcap_mismatch`, `capacity_mismatch` or `unexplained` (plan §4: every
// difference must be explained), and `benign_lru` at most 20%.
// Unexplained differences are listed for triage.
//
// Usage: node tools/residency_shadow_report.mjs app.log [more.log ...]

import { readFileSync } from 'node:fs';

function readInput(paths) {
  if (paths.length === 0) return readFileSync(0, 'utf8');
  return paths.map((path) => readFileSync(path, 'utf8')).join('\n');
}

/** The JSON object a log line carries, if it is a shadow record. */
export function parseShadowLine(line) {
  const start = line.search(/\{"(ep|drawcap)":/);
  if (start < 0) return null;
  const end = line.lastIndexOf('}');
  if (end < start) return null;
  try {
    const record = JSON.parse(line.slice(start, end + 1));
    return typeof record.verdict === 'string' ? record : null;
  } catch {
    return null;
  }
}

export function summarize(records) {
  const counts = new Map();
  let episodes = 0;
  for (const record of records) {
    counts.set(record.verdict, (counts.get(record.verdict) ?? 0) + 1);
    if ('ep' in record) episodes += 1;
  }
  const count = (verdict) => counts.get(verdict) ?? 0;
  const benignShare = episodes === 0 ? 0 : count('benign_lru') / episodes;
  const failures = [];
  if (episodes < 50) failures.push(`only ${episodes} episodes (need 50)`);
  for (const verdict of ['unsafe', 'drawcap_mismatch', 'capacity_mismatch', 'unexplained']) {
    if (count(verdict) > 0) failures.push(`${count(verdict)} ${verdict}`);
  }
  if (benignShare > 0.2) failures.push(`benign_lru ${(benignShare * 100).toFixed(0)}% (max 20%)`);
  return { counts, episodes, benignShare, failures };
}

function main() {
  const records = readInput(process.argv.slice(2)).split('\n').map(parseShadowLine).filter(Boolean);
  const { counts, episodes, failures } = summarize(records);
  console.log(`episodes: ${episodes}`);
  for (const [verdict, n] of [...counts].sort()) console.log(`  ${verdict}: ${n}`);
  const toTriage = records.filter(
    (r) => !['agree', 'benign_lru'].includes(r.verdict) && !r.verdict.startsWith('expected:'),
  );
  if (toTriage.length > 0) {
    console.log('\nto triage:');
    for (const record of toTriage) console.log(`  ${JSON.stringify(record)}`);
  }
  console.log(
    failures.length === 0 ? '\npass bar: met' : `\npass bar: NOT met (${failures.join('; ')})`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
