/**
 * A statistic symbol in paper notation (UI redesign phase 3, Proposal C):
 * the variable in italic, the degrees of freedom and function names upright,
 * e.g. *t*(24), *F*(2,30), *z*, −log10(*p*). Labels that are not a known
 * symbol (an `intent_name` such as "beta") render upright.
 */
import React from 'react';
import { splitStatisticSymbol } from '@/utils/statistic';

export function StatSymbol({ label, className }: { label: string; className?: string }) {
  return (
    <span className={className} data-testid="stat-symbol">
      {splitStatisticSymbol(label).map((part, i) =>
        part.italic ? (
          <i key={i} className="italic">
            {part.text}
          </i>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ),
      )}
    </span>
  );
}
