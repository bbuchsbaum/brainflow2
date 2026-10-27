import { displayFolderFile } from '@/services/studio/folderSource';
import { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { Button, Notice, NumberField, Select, TextField } from '@/components/ui/bf';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';
import { canImportCandidate } from '@/services/studio/importContract';

const PAGE_SIZE = 40;

/** A pending folder draft occupies the center pane; the existing study stays intact. */
export function StudioFolderReview() {
  const dialog = useSetStudioStore((state) => state.importDialog);
  const candidates = useSetStudioStore((state) => state.importCandidates);
  const service = getSetIngestionService();
  useEffect(() => service.retainFolderReview(), [service]);
  const [path, setPath] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const candidate = dialog.selectedCandidateId ? candidates[dialog.selectedCandidateId] : null;
  const summary = dialog.ontologyPreview;
  const source =
    dialog.folderSource?.root === dialog.discoveryRoot ? dialog.folderSource : undefined;
  const discovery = candidate?.discovery;
  const busy = dialog.isLoading || dialog.isOntologyLoading;
  const proposal = summary?.candidates.find((item) => item.filePattern === dialog.filePattern);
  const groups = discovery?.groups ?? proposal?.groups ?? [];
  const images = discovery?.observedRoles ?? proposal?.observedRoles ?? [];
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(groups.length / PAGE_SIZE) - 1));
  const rows = groups.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
  const issues = candidate?.set.ingestAudit.join.issueDetails ?? [];
  const missing = groups.reduce(
    (count, group) =>
      count +
      images.filter((image) => !group.bindings.some((binding) => binding.role === image)).length,
    0,
  );
  const truncated = summary?.truncated || discovery?.truncated;
  const canOpen = !!candidate && !busy && !dialog.error && canImportCandidate(candidate);

  return (
    <section
      aria-label="Open set review"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-background text-foreground"
    >
      <header className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-bf-lg font-semibold">
            <FolderOpen size={18} />
            Open set
          </h1>
          <Button variant="ghost" size="sm" onClick={() => void service.chooseFolderReview()}>
            Change folder…
          </Button>
        </div>
        <div className="min-w-0 text-bf-md">
          {(source?.label || summary?.sourceLabel) && (
            <div className="font-medium">{source?.label || summary?.sourceLabel}</div>
          )}
          <div
            className="break-all text-muted-foreground"
            title={source?.displayPath ?? dialog.discoveryRoot}
          >
            {source?.displayPath ?? dialog.discoveryRoot}
          </div>
        </div>
        <div
          className="flex flex-wrap items-center justify-between gap-2 text-bf-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span>
            {dialog.isOntologyLoading
              ? 'Finding images…'
              : dialog.isLoading
                ? 'Checking organization…'
                : `${groups.length} members · ${images.length} images`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void service.scanFolderReview()}
            icon={<RefreshCw size={14} />}
          >
            Scan again
          </Button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 overflow-auto p-4">
        {(dialog.ontologyError || dialog.error) && (
          <Notice role="alert" severity="danger" className="mb-3">
            {dialog.ontologyError || dialog.error} Your current study has not changed. Reconnect the
            source if needed, then scan again.
          </Notice>
        )}
        {truncated && (
          <Notice role="alert" severity="warning" className="mb-3">
            The scan limit was reached. Some files have not been examined. Narrow the folder or
            increase the limit under Advanced options, then scan again.
          </Notice>
        )}
        {summary && summary.candidates.length > 0 && (
          <div className="mb-4 space-y-2">
            <label htmlFor="folder-organization" className="text-bf-md font-medium">
              Organize members
            </label>
            <Select
              id="folder-organization"
              value={proposal?.id ?? ''}
              disabled={busy || !!truncated}
              onValueChange={(value) => {
                if (!value) return;
                setPage(0);
                setPath(null);
                void service.reviewOrganization(value);
              }}
            >
              {proposal ? null : (
                <option value="" disabled>
                  Choose an organization
                </option>
              )}
              {summary.candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            <p className="text-bf-sm leading-relaxed text-muted-foreground">
              {proposal?.description ?? 'Choose how the files become members and images.'}
            </p>
          </div>
        )}
        {!busy && summary && summary.candidates.length === 0 && (
          <p className="py-6 text-bf-md text-muted-foreground">
            No images were found. Choose another folder or change the scan depth.
          </p>
        )}
        {groups.length > 0 && (
          <>
            <div
              className="max-w-full overflow-x-auto rounded-sm border border-border"
              tabIndex={0}
              aria-label="Member and image assignments"
            >
              <table className="w-full border-collapse text-left text-bf-md">
                <caption className="sr-only">
                  Members as rows and images as columns. Select an available image to inspect its
                  source path.
                </caption>
                <thead className="bg-muted">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted p-3">Member</th>
                    {images.map((image) => (
                      <th key={image} className="min-w-36 max-w-56 break-all p-3 font-medium">
                        {image}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((group) => (
                    <tr key={group.memberId} className="border-t border-border">
                      <th scope="row" className="sticky left-0 bg-background p-3 font-medium">
                        {group.memberId}
                      </th>
                      {images.map((image) => {
                        const bindings = group.bindings.filter((binding) => binding.role === image);
                        return (
                          <td key={image} className="p-2">
                            {bindings.length ? (
                              <Button
                                variant="link"
                                className="min-h-6"
                                size="sm"
                                onClick={() =>
                                  setPath(
                                    bindings
                                      .map((binding) =>
                                        displayFolderFile(binding.sourcePath, source),
                                      )
                                      .join('\n'),
                                  )
                                }
                                aria-label={`${group.memberId}, ${image}: ${bindings.length > 1 ? `${bindings.length} files` : 'Available'}`}
                              >
                                {bindings.length > 1
                                  ? `${bindings.length} files — review`
                                  : 'Available'}
                              </Button>
                            ) : (
                              <span className="px-2 text-muted-foreground">Missing</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {groups.length > PAGE_SIZE && (
              <div className="mt-2 flex items-center justify-between text-bf-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pageIndex === 0}
                  onClick={() => setPage(pageIndex - 1)}
                >
                  Previous
                </Button>
                <span>
                  {pageIndex * PAGE_SIZE + 1}–{Math.min((pageIndex + 1) * PAGE_SIZE, groups.length)}{' '}
                  of {groups.length} members
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(pageIndex + 1) * PAGE_SIZE >= groups.length}
                  onClick={() => setPage(pageIndex + 1)}
                >
                  Next
                </Button>
              </div>
            )}
            {missing > 0 && (
              <p className="mt-3 text-bf-md text-muted-foreground">
                {missing} missing image assignments. Available images can still be browsed.
              </p>
            )}
          </>
        )}
        {path && (
          <div className="mt-3 rounded-sm border border-border p-3 text-bf-sm" aria-label="Image source">
            <div className="mb-2 flex items-center justify-between">
              <strong>Source path</strong>
              <Button size="sm" variant="ghost" onClick={() => setPath(null)}>
                Close
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all font-mono">{path}</pre>
          </div>
        )}
        {issues.length > 0 && (
          <details className="mt-3 text-bf-md">
            <summary className="cursor-pointer">
              Review {issues.length} import {issues.length === 1 ? 'issue' : 'issues'}
            </summary>
            <ul className="mt-2 space-y-2 pl-4">
              {issues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </details>
        )}
        {summary?.warnings.map((warning, index) => (
          <p key={index} className="mt-2 text-bf-sm text-muted-foreground">
            {warning.message}
          </p>
        ))}
        <details className="mt-5 border-t border-border pt-3">
          <summary className="cursor-pointer text-bf-md text-muted-foreground">
            Advanced options
          </summary>
          <div className="mt-3 grid min-w-0 gap-3">
            <label className="space-y-1 text-bf-sm">
              Folder path
              <TextField
                value={dialog.discoveryRoot}
                onChange={(event) => service.editFolderReview('root', event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-bf-sm">
                Search depth
                <NumberField
                  min="1"
                  value={dialog.discoveryMaxDepth}
                  onChange={(event) => service.editFolderReview('depth', event.target.value)}
                />
              </label>
              <label className="space-y-1 text-bf-sm">
                Maximum images
                <NumberField
                  min="1"
                  value={dialog.discoveryMaxFiles}
                  onChange={(event) => service.editFolderReview('limit', event.target.value)}
                />
              </label>
            </div>
            <label className="space-y-1 text-bf-sm">
              Filename matching (regex)
              <TextField
                mono
                value={dialog.filePattern}
                onChange={(event) => service.editFolderReview('pattern', event.target.value)}
              />
            </label>
            <Button
              variant="secondary" size="sm"
              disabled={busy || !dialog.discoveryRoot.trim()}
              onClick={() => void service.openImportPreview('regex')}
            >
              Check filename matching
            </Button>
            <p className="text-bf-sm text-muted-foreground">
              Discovery lists files without downloading images. Image information is checked when a
              member is opened; population operations check their required inputs separately.
            </p>
          </div>
        </details>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background p-4">
        <p className="min-w-0 flex-1 text-bf-sm text-muted-foreground">
          {candidate && !canImportCandidate(candidate)
            ? candidate.contract.reason
            : 'Open for browsing.'}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => service.cancelReview()}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canOpen} onClick={() => void service.confirmReview()}>
            Open set
          </Button>
        </div>
      </footer>
    </section>
  );
}
