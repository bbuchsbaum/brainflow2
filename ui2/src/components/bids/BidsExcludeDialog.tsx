import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Notice, Select, TextField } from '@/components/ui/bf';
import { Modal } from '@/components/ui/Modal';
import { selectBidsModel, useBidsStore } from '@/stores/bidsStore';
import { EXCLUDED_MEAN_NOTE, runLabel } from '@/stores/bidsModel';
import {
  EXCLUSIONS_DESCRIPTION,
  EXCLUSIONS_TSV,
  buildExclusionRow,
  exclusionContext,
  exclusionCriteria,
  exclusionDescriptionPreview,
  exclusionScopes,
  exclusionTsvHeader,
  exclusionTsvLine,
  isFirstExclusionWrite,
  localDate,
  rememberAuthor,
  rememberedAuthor,
  type BidsExclusionScope,
} from '@/stores/bidsExclusions';
import { cn } from '@/utils/cn';

const Preview = ({ children, testId }: { children: string; testId: string }) => (
  <pre
    data-testid={testId}
    className="m-0 mt-1 whitespace-pre-wrap break-all rounded-bf-xs bg-bf-bg-panel-sunken px-2 py-1.5 font-mono text-bf-2xs text-bf-text-secondary"
    style={{ tabSize: 2 }}
  >
    {children}
  </pre>
);

const FieldLabel = ({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-bf-xs text-bf-text-muted">
    {children}
  </label>
);

async function tauriVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

/** X: scope, reason, and the exact row and files a write will touch. */
export function BidsExcludeDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  // One reading at open: the preview must not shift under a streaming scan.
  const [opened] = useState(() => {
    const state = useBidsStore.getState();
    return {
      model: selectBidsModel(state),
      censor: state.censor,
      written: state.exclusionsWritten,
      exclusions: state.exclusions,
      // The path the store writes to; the index holds the canonical one, which may differ.
      datasetPath: state.datasetPath,
    };
  });
  const { model, censor, written, exclusions, datasetPath } = opened;
  const facts = model.runsById.get(runId);
  const index = model.index;
  const writeExclusions = useBidsStore((state) => state.writeExclusions);
  const datasetLeft = useBidsStore((state) => state.datasetPath !== datasetPath);

  // Everything here reads the dataset it opened on.
  useEffect(() => {
    if (datasetLeft) onClose();
  }, [datasetLeft, onClose]);

  const criteria = useMemo(
    () => (facts ? exclusionCriteria(facts, model, censor) : []),
    [facts, model, censor],
  );
  const scopes = useMemo(() => (facts ? exclusionScopes(facts, model) : []), [facts, model]);
  const [scope, setScope] = useState<BidsExclusionScope>('run');
  const [criterionId, setCriterionId] = useState(() => {
    const first = criteria[0];
    return first?.triggered ? first.id : 'manual';
  });
  const [reason, setReason] = useState<string | null>(null);
  const [author, setAuthor] = useState(() => rememberedAuthor(index?.default_author ?? ''));
  const [date] = useState(() => localDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void tauriVersion().then((version) => live && setAppVersion(version));
    return () => {
      live = false;
    };
  }, []);

  if (!facts || !index) return null;
  const criterion = criteria.find((item) => item.id === criterionId) ?? criteria[criteria.length - 1];
  const reasonText = reason ?? criterion.reason;
  const row = buildExclusionRow({ facts, scope, reason: reasonText, criterion, author, date });
  const context = exclusionContext(model);
  const first = isFirstExclusionWrite(index, exclusions, written);
  const blocked = index.is_remote;
  const canWrite = !blocked && !busy && row.reason !== '' && row.author !== '';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    rememberAuthor(row.author);
    writeExclusions([row], context, datasetPath).then(onClose, (failure: unknown) => {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Exclude ${runLabel(facts.run)}`}
      size="xl"
      bodyClassName="p-4"
      initialFocusRef={reasonRef}
      className="max-w-[640px]"
    >
      <form className="flex flex-col gap-3" onSubmit={submit} data-testid="bids-exclude-dialog">
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0" aria-label="Scope">
          {scopes.map((option) => (
            <label key={option.scope} className="inline-flex cursor-pointer items-center gap-1.5 text-bf-sm">
              <input
                type="radio"
                name="bids-exclude-scope"
                checked={scope === option.scope}
                onChange={() => setScope(option.scope)}
                className="accent-[var(--bf-text-primary)]"
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <div>
          <FieldLabel htmlFor="bids-exclude-criterion">Criterion</FieldLabel>
          <Select
            id="bids-exclude-criterion"
            value={criterion.id}
            onChange={(event) => {
              setCriterionId(event.target.value);
              setReason(null);
            }}
          >
            {criteria.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
          <p className="m-0 mt-1 text-bf-xs text-bf-text-faint">
            Session means: {EXCLUDED_MEAN_NOTE}.
          </p>
        </div>

        <div>
          <FieldLabel htmlFor="bids-exclude-reason">Reason</FieldLabel>
          <TextField
            ref={reasonRef}
            id="bids-exclude-reason"
            value={reasonText}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div>
          <FieldLabel htmlFor="bids-exclude-author">Author</FieldLabel>
          <TextField
            id="bids-exclude-author"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
        </div>

        <div className="text-bf-xs text-bf-text-muted">
          Row written to <span className="font-mono">{EXCLUSIONS_TSV}</span>
          <Preview testId="bids-exclude-preview">
            {`${exclusionTsvHeader}\n${exclusionTsvLine(row)}`}
          </Preview>
        </div>

        {first ? (
          <div className="text-bf-xs text-bf-text-muted">
            First exclusion also creates <span className="font-mono">{EXCLUSIONS_DESCRIPTION}</span>
            <Preview testId="bids-exclude-description">
              {exclusionDescriptionPreview(index, context, appVersion)}
            </Preview>
          </div>
        ) : null}

        {blocked ? (
          <Notice severity="warning" role={undefined}>
            Exclusions cannot be written on a remote mount: a mirror's copy would not reach the server.
          </Notice>
        ) : null}
        {error ? (
          <Notice severity="danger" role="alert">
            Nothing was written: {error}
          </Notice>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <span className={cn('mr-auto text-bf-xs text-bf-text-faint')}>
            Nothing in the raw dataset changes. Revert any time from Findings.
          </span>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={!canWrite}>
            Exclude ↵
          </Button>
        </div>
      </form>
    </Modal>
  );
}
