import { Button } from '@/components/ui/bf';
import { useState } from 'react';
import type { SampleFrame } from '@/plotting';
import type { PopulationPartition } from '@/types/population';
import { populationPivot } from '@/services/studio/populationPivot';
import { populationProbeActions } from '@/services/studio/PopulationProbeActions';
export function PopulationPivot({
  partition,
  frame,
  current,
}: {
  partition: PopulationPartition;
  frame: SampleFrame;
  current: boolean;
}) {
  const [rowPage, setRowPage] = useState(0),
    [columnPage, setColumnPage] = useState(0);
  let pivot;
  try {
    pivot = populationPivot(partition, frame);
  } catch {
    return null;
  }
  const rows = pivot.rows.slice(rowPage * 8, rowPage * 8 + 8),
    columns = pivot.columns.slice(columnPage * 8, columnPage * 8 + 8);
  return (
    <details
      className="rounded-sm border border-border p-2 text-bf-sm"
      aria-label="Population group matrix"
    >
      <summary className="cursor-pointer">
        Group matrix · {partition.factorColumns!.join(' × ')}
      </summary>
      <p className="my-2 text-muted-foreground">
        Observation means at this probe; finite / total rows. This is a descriptive row summary, not
        a participant-level test. Click a cell to select its exact observations; focus stays fixed.
      </p>
      {(pivot.rows.length > 8 || pivot.columns.length > 8) && (
        <div className="flex flex-wrap gap-2 my-2">
          <Button variant="secondary" size="sm" disabled={!rowPage} onClick={() => setRowPage(rowPage - 1)}>
            Previous rows
          </Button>
          <Button variant="secondary" size="sm"
            disabled={(rowPage + 1) * 8 >= pivot.rows.length}
            onClick={() => setRowPage(rowPage + 1)}
          >
            Next rows
          </Button>
          <Button variant="secondary" size="sm"
            disabled={!columnPage}
            onClick={() => setColumnPage(columnPage - 1)}
          >
            Previous columns
          </Button>
          <Button variant="secondary" size="sm"
            disabled={(columnPage + 1) * 8 >= pivot.columns.length}
            onClick={() => setColumnPage(columnPage + 1)}
          >
            Next columns
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="p-2">
                {partition.factorColumns![0]} / {partition.factorColumns![1]}
              </th>
              {columns.map((column) => (
                <th className="p-2" key={JSON.stringify(column)}>
                  {column ?? '(missing)'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={JSON.stringify(row)}>
                <th className="p-2">{row ?? '(missing)'}</th>
                {columns.map((column) => {
                  const cell = pivot.cells.find((c) => c.row === row && c.column === column);
                  return (
                    <td className="border-t border-border p-1" key={JSON.stringify(column)}>
                      {cell ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-auto w-full flex-col items-start whitespace-normal py-1"
                          disabled={!current}
                          title={cell.group.label}
                          onClick={() =>
                            populationProbeActions.select(
                              cell.group.memberIds,
                              'replace',
                              'metadata',
                              cell.group.label,
                            )
                          }
                        >
                          <span className="block tabular-nums">
                            {cell.mean === null ? 'Unavailable' : cell.mean.toPrecision(4)}
                          </span>
                          <span className="text-muted-foreground">
                            {cell.valid} / {cell.count} rows
                          </span>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">No observations</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
