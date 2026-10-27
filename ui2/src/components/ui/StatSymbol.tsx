/**
 * A statistic symbol in paper notation (UI redesign phase 3, Proposal C):
 * the variable in italic, the degrees of freedom and function names upright,
 * e.g. *t*(24), *F*(2,30), *z*, −log10(*p*). Labels that are not a known
 * symbol (an `intent_name` such as "beta") render upright.
 */
import React from 'react';
import { splitStatisticSymbol, statisticLongName } from '@/utils/statistic';
import { cn } from '@/utils/cn';

export function StatSymbol({ label, className }: { label: string; className?: string }) {
  // Always the sans face (so the statistic z never reads as the mono plane
  // "z"), with a spoken long form ("t statistic, 24 degrees of freedom").
  const longName = statisticLongName(label);
  return (
    <span
      className={cn('font-sans', className)}
      data-testid="stat-symbol"
      role="img"
      aria-label={longName}
      title={longName}
    >
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
