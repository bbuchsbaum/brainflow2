/**
 * One typographic form for a threshold expression everywhere it appears
 * (colorbar footer, Inspector threshold caption, Compare scope line):
 * numbers mono, the statistic variable italic sans ("|z| ≤ 3.1 hidden"),
 * "hidden" in sans (v3 visual critic: |z| was written three ways).
 */
import { Fragment } from 'react';
import { statisticLongName } from '@/utils/statistic';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ThresholdText({ line, variable }: { line: string; variable: string }) {
  const hidden = line.endsWith('hidden');
  const expr = hidden ? line.slice(0, -'hidden'.length).trimEnd() : line;
  const parts =
    variable && variable !== 'value'
      ? expr.split(new RegExp(`(?<![\\w])(${escape(variable)})(?![\\w(])`))
      : [expr];
  return (
    <>
      {expr && (
        <span className="font-mono tabular-nums" data-testid="threshold-text">
          {parts.map((part, i) =>
            i % 2 === 1 ? (
              // Spoken as the long name: "z*" is "z score, inferred from
              // file name", never "z star".
              <i key={i} className="font-sans italic" role="img" aria-label={statisticLongName(part)}>
                {part}
              </i>
            ) : (
              <Fragment key={i}>{part}</Fragment>
            ),
          )}
        </span>
      )}
      {hidden && <span className="font-sans">{expr ? ' hidden' : 'hidden'}</span>}
    </>
  );
}
