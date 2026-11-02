import React, { useState } from 'react';
import { Button, TextArea, TextField } from '@/components/ui/bf';
import { captureActiveWorkspace, useModuleCrosshairStyle } from '@/modules/api/host';
import { parseSegmentationLabels } from '@/modules/segmentation/labelTable';
import { colourCandidates } from './shared/workflowRules';
const palette = [[232, 108, 92], [90, 165, 220], [183, 133, 213], [49, 174, 176], [204, 167, 82], [205, 112, 167], [140, 174, 97], [105, 139, 207]].map((rgb) => `rgb(${rgb.join(' ')})`);
export function LabelTableEditor({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [name, setName] = useState(''), [abbreviation, setAbbreviation] = useState(''), [chosen, setChosen] = useState(''), [error, setError] = useState<string | null>(null);
  const crosshair = useModuleCrosshairStyle();
  let table: ReturnType<typeof parseSegmentationLabels> = [];
  try { table = parseSegmentationLabels(value); } catch { /* JSON remains directly editable; validate before adding/creating. */ }
  const warning = getComputedStyle(document.documentElement).getPropertyValue('--bf-warning').trim();
  const candidates = colourCandidates(palette, table.map((label) => ({ name: label.name, color: `rgb(${label.color.join(' ')})` })), [{ name: 'crosshair', color: crosshair.color }, ...(warning ? [{ name: 'warning', color: warning }] : [])]);
  const selected = candidates.find((candidate) => candidate.color === chosen && candidate.ok) ?? candidates.find((candidate) => candidate.ok);
  const add = () => {
    try {
      const rows = parseSegmentationLabels(value), ids = new Set(rows.map((label) => label.id));
      let id = 1; while (ids.has(id) && id <= 65535) id++;
      if (id > 65535 || !selected || !name.trim() || !abbreviation.trim()) return;
      const color = selected.color.match(/[\d.]+/g)!.map(Number) as [number, number, number];
      onChange(JSON.stringify([...rows, { id, name: name.trim(), abbreviation: abbreviation.trim(), color, parent: null }], null, 2)); setName(''); setAbbreviation(''); setChosen(''); setError(null);
    } catch (caught) { setError(String(caught)); }
  };
  return <fieldset className="flex flex-col gap-2"><legend className="mb-1">Label table</legend>
    <label className="text-bf-2xs text-bf-text-muted">JSON labels<TextArea aria-label="Label table JSON" mono value={value} onChange={(event) => onChange(event.target.value)} rows={5} /></label>
    <label className="text-bf-2xs text-bf-text-muted">Import table<input type="file" accept=".json,application/json" className="block w-full text-bf-xs" onChange={(event) => { const file = event.target.files?.[0], lease = captureActiveWorkspace(); if (!file || !lease) return; if (file.size > 4 * 1024 * 1024) { setError('Label tables must be smaller than 4 MiB.'); return; } void file.text().then((contents) => { if (lease.isCurrent()) { parseSegmentationLabels(contents); onChange(contents); setError(null); } }).catch((caught) => { if (lease.isCurrent()) setError(String(caught)); }); }} /></label>
    <div className="mt-1 grid grid-cols-[1fr_80px] gap-2"><label>Name<TextField value={name} onChange={(event) => setName(event.target.value)} /></label><label>Abbreviation<TextField value={abbreviation} onChange={(event) => setAbbreviation(event.target.value)} /></label></div>
    <div className="flex flex-wrap items-center gap-2" aria-label="Distinct label color candidates">{candidates.map((candidate) => <button key={candidate.color} type="button" aria-label={`Use label color ${candidate.color}`} aria-pressed={selected?.color === candidate.color} disabled={!candidate.ok} title={candidate.reason ?? 'Distinct in full color and muted tints'} className={`h-5 w-5 rounded-sm border disabled:opacity-30 ${selected?.color === candidate.color ? 'border-bf-text-primary' : 'border-bf-border-subtle'}`} style={{ background: candidate.color }} onClick={() => setChosen(candidate.color)} />)}<Button type="button" size="sm" disabled={!name.trim() || !abbreviation.trim() || !selected} onClick={add}>Add label</Button></div>
    {error ? <p role="alert" className="text-bf-2xs text-bf-warning">{error}</p> : null}
  </fieldset>;
}
