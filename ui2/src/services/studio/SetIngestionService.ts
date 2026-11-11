import { noteRemoteConnectionFailure } from '@/services/RemoteReconnectService';
import { formatTauriError, tauriErrorCode } from '@/utils/formatTauriError';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { describeFolderSource } from './folderSource';
import {
  HELD_WORK_REVIEW_REASON,
  decideFolderOpen,
  folderSetName,
  folderShapeLabel,
} from './folderOpenDecision';
import { setNeedsGridCheck } from './studioReadiness';
import type { BackendTransport } from '@/services/transport';
import { getTransport } from '@/services/transport';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { nextImportRequestId } from '@/stores/setStudio/importMachine';
import { initialPopulationState } from '@/stores/setStudio/populationSlice';
import type { PopulationState } from '@/types/population';
import type {
  SpatialFieldSetSummary,
  StudioImportCandidate,
  StudioImportMode,
} from '@/types/studio';
import type {
  StudioImportCandidate as BackendStudioImportCandidate,
  StudioDiscoveryPromotionResult,
  StudioFolderOntologyPreviewRequest,
  StudioFolderOntologySummary,
  StudioImportPreviewRequest,
} from '@brainflow/api';

/**
 * How long a preview's cancellation ticket lives. This is the longest the
 * backend admits (population_sampling.rs, MAX_LIFETIME_MS): it refuses a
 * later deadline, and a ticket cannot be renewed (the same id with another
 * deadline is rejected). The deadline also ends the command: a ticketed
 * preview is stopped by the backend when its ticket expires, so there is
 * never a running preview that an expired ticket can no longer cancel.
 */
const PREVIEW_TICKET_LIFETIME_MS = 120_000;

/** Bridge code of "Population sampling canceled or expired." */
const TICKET_ENDED_CODE = 2026;

/**
 * How long a completed header check stands in for the re-scan "Open set"
 * otherwise runs (see confirmReview).
 */
export const REVIEW_PREVIEW_REUSE_MS = 5 * 60_000;

/** The abort reason of a grid check the user cancelled. */
const USER_CANCELLED = 'cancelled-by-user';

/**
 * How a grid check ended. `interrupted`: the set was switched away from or
 * the Studio left while it ran. `skipped`: there was nothing to check, or a
 * check was already running.
 */
export type GridCheckOutcome = 'applied' | 'failed' | 'cancelled' | 'interrupted' | 'skipped';

/** A ticketed preview that the backend stopped at its ticket's deadline. */
class PreviewTimedOutError extends Error {
  constructor() {
    super(
      'Reading this folder took longer than two minutes and was stopped. Narrow the folder or the filename rule and try again.',
    );
    this.name = 'PreviewTimedOutError';
  }
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Effect interpreter for the import state machine's async lifecycle.
 *
 * The service dispatches the guarded `*_REQUESTED` event (carrying a request id
 * drawn from `nextImportRequestId`) before invoking the backend, and the
 * matching `*_SUCCEEDED` / `*_FAILED` event afterward. Staleness — dropping the
 * result when a newer request superseded it, the mode changed, or the discovery
 * root changed — lives entirely inside `importReducer`, so the service no longer
 * carries any `isStillCurrent` / fallback bookkeeping of its own.
 */
export class SetIngestionService {
  private transport: BackendTransport;
  private requestVersion = 0;
  private activeFolderRequest: AbortController | null = null;
  private folderReviewViews = 0;
  /** The latest `openFolderReview` call: it owns the "Opening …" flag. */
  private folderOpenRun = 0;
  private gridCheckRun = 0;
  private activeGridCheck: AbortController | null = null;
  /**
   * Sets (by the discovery they were opened with) whose automatic grid check
   * has run, failed or been cancelled by the user: it is not started again.
   * A set opened again from its folder has a new discovery, so is checked.
   */
  private autoGridChecks = new WeakSet<object>();
  /** The folder-review preview on screen, when it read the image headers. */
  private checkedReviewPreview: {
    requestKey: string;
    requestId: number;
    candidate: StudioImportCandidate;
    completedAtMs: number;
  } | null = null;

  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }

  async openImportPreview(mode: StudioImportMode): Promise<void> {
    const requestId = (this.requestVersion = nextImportRequestId());
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'PREVIEW_REQUESTED', mode, requestId });

    this.checkedReviewPreview = null;
    const request = this.buildPreviewRequest(mode);
    try {
      const candidates = await this.invokePreview<BackendStudioImportCandidate[]>(
        'preview_set_studio_imports',
        request,
      );

      if (Array.isArray(candidates) && candidates.length > 0) {
        useSetStudioStore.getState().dispatchImportEvent({
          type: 'PREVIEW_SUCCEEDED',
          mode,
          requestId,
          candidates: candidates as StudioImportCandidate[],
          source: 'backend',
        });
        this.rememberCheckedReviewPreview(mode, requestId, request);
        return;
      }

      throw new Error('Backend returned no import preview candidates.');
    } catch (error) {
      const message = formatTauriError(error);
      useSetStudioStore.getState().dispatchImportEvent({
        type: 'PREVIEW_FAILED',
        mode,
        requestId,
        message,
        now: Date.now(),
      });
    }
  }

  async openFolderOntologyPreview(root?: string | null): Promise<void> {
    const requestId = (this.requestVersion = nextImportRequestId());
    useSetStudioStore
      .getState()
      .dispatchImportEvent({ type: 'ONTOLOGY_REQUESTED', root: root ?? null, requestId });
    const request = this.buildFolderOntologyRequest();

    try {
      const summary = await this.invokePreview<StudioFolderOntologySummary>(
        'preview_folder_ontology',
        { request },
      );

      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_SUCCEEDED', requestId, summary });
    } catch (error) {
      const message = formatTauriError(error);
      useSetStudioStore
        .getState()
        .dispatchImportEvent({ type: 'ONTOLOGY_FAILED', requestId, message });
    }
  }

  /**
   * Scan a folder and open it as a set.
   *
   * A folder with nothing to decide (see {@link decideFolderOpen}) opens
   * straight into the Studio once scanned, with a one-line notice that
   * offers its review. Anything missing, ambiguous or warned about stops at
   * the review, which is a draft: it never replaces the current study until
   * confirmed. So does `review: true` (the notice's "Review…", "Change
   * folder…" inside a review), and a Studio whose current study holds work
   * the new set would discard.
   */
  async openFolderReview(root: string, options: { review?: boolean } = {}): Promise<void> {
    if (!root.trim()) return;
    const heldWork = !options.review && studyHoldsWork();
    const direct = !options.review && !heldWork;
    const store = useSetStudioStore.getState();
    // Until the scan says whether a review is needed, the Studio shows
    // "Opening …", not a review form that may close by itself.
    store.setStudioFolderOpening(direct ? root : null);
    // A review nobody asked for says why it is shown; one asked for does not.
    store.setStudioFolderReviewReason(null);
    if (heldWork) this.noteFolderReviewReason(root, HELD_WORK_REVIEW_REASON);
    store.dispatchImportEvent({
      type: 'FOLDER_REVIEW_OPENED',
      root,
      source: describeFolderSource(root, useFileBrowserStore.getState().entries),
    });
    const open = ++this.folderOpenRun;
    try {
      const scanned = await this.scanFolderReview();
      if (direct && scanned) this.openScannedFolderDirectly(root);
    } finally {
      // Opened, or left for review: either way the answer is in. A newer
      // open (of another folder, or of this one again) owns the flag now and
      // keeps it until its own scan is decided.
      if (open === this.folderOpenRun) useSetStudioStore.getState().setStudioFolderOpening(null);
    }
  }

  /** Open the draft just scanned without its review, when nothing needs deciding. */
  private openScannedFolderDirectly(root: string): void {
    const state = useSetStudioStore.getState();
    const dialog = state.importDialog;
    const candidate = dialog.selectedCandidateId
      ? state.importCandidates[dialog.selectedCandidateId]
      : null;
    if (
      !dialog.isOpen ||
      !dialog.folderReview ||
      dialog.isLoading ||
      dialog.isOntologyLoading ||
      dialog.error ||
      dialog.ontologyError ||
      dialog.discoveryRoot !== root
    )
      return;
    // Work added while the folder was being scanned is not discarded either.
    if (studyHoldsWork()) {
      this.noteFolderReviewReason(root, HELD_WORK_REVIEW_REASON);
      return;
    }
    const decision = decideFolderOpen(dialog.ontologyPreview, candidate);
    if (!decision.direct) {
      this.noteFolderReviewReason(root, decision.reason);
      return;
    }
    if (!candidate) return;
    this.checkedReviewPreview = null;
    state.confirmImportCandidate();
    const opened = useSetStudioStore.getState();
    if (opened.importDialog.isOpen || opened.selection.activeSetId !== candidate.set.id) return;
    opened.setStudioOpenNotice({
      setId: candidate.set.id,
      root,
      message: `Opened ${folderShapeLabel(decision.members, decision.images)} from ${folderSetName(root) ?? 'the folder'}.`,
    });
  }

  /** Record, for the review and the console, why a one-step open stopped at the review. */
  private noteFolderReviewReason(root: string, reason: string): void {
    console.info(`[SetIngestionService] Folder shown for review (${root}): ${reason}`);
    useSetStudioStore.getState().setStudioFolderReviewReason({ root, reason });
  }

  /** Bring up the review of the folder the active set was opened from. */
  async reviewOpenedFolder(): Promise<void> {
    const notice = useSetStudioStore.getState().studioOpenNotice;
    if (notice) await this.openFolderReview(notice.root, { review: true });
  }

  /** Ask for a NeuroTabs manifest, then preview exactly that file; cancelling changes nothing. */
  async chooseManifestPreview(): Promise<void> {
    const before = useSetStudioStore.getState().importDialog;
    let path: string | null;
    try {
      path = await this.transport.invoke<string | null>('plugin:dialog|open', {
        options: {
          directory: false,
          multiple: false,
          title: 'Open a NeuroTabs manifest',
          filters: [{ name: 'NeuroTabs manifest', extensions: ['yaml', 'yml', 'json'] }],
        },
      });
    } catch (error) {
      if (useSetStudioStore.getState().importDialog !== before) return;
      const requestId = (this.requestVersion = nextImportRequestId());
      const state = useSetStudioStore.getState();
      state.dispatchImportEvent({ type: 'PREVIEW_REQUESTED', mode: 'manifest', requestId });
      state.dispatchImportEvent({
        type: 'PREVIEW_FAILED',
        mode: 'manifest',
        requestId,
        message: formatTauriError(error),
        now: Date.now(),
      });
      return;
    }
    if (!path || useSetStudioStore.getState().importDialog !== before) return;
    useSetStudioStore.getState().setManifestPath(path);
    await this.openImportPreview('manifest');
  }

  async chooseFolderReview(options: { review?: boolean } = {}): Promise<void> {
    const before = useSetStudioStore.getState().importDialog;
    try {
      const root = await this.transport.invoke<string | null>('plugin:dialog|open', {
        options: { directory: true, multiple: false, title: 'Choose a folder to open as a set' },
      });
      if (root && useSetStudioStore.getState().importDialog === before)
        await this.openFolderReview(root, options);
    } catch (error) {
      const state = useSetStudioStore.getState();
      if (state.importDialog !== before) return;
      state.dispatchImportEvent({ type: 'FOLDER_REVIEW_OPENED', root: before.discoveryRoot });
      state.setFolderOntologyPreviewError(formatTauriError(error));
    }
  }

  /**
   * Scan the review's folder and preview its proposed organisation. True
   * when both finished and nothing has been asked for since: the draft on
   * screen is this scan's.
   */
  async scanFolderReview(): Promise<boolean> {
    const root = useSetStudioStore.getState().importDialog.discoveryRoot;
    if (!root.trim()) return false;
    const pending = this.openFolderOntologyPreview(root);
    const version = this.requestVersion;
    await pending;
    if (version !== this.requestVersion) return false;
    const state = useSetStudioStore.getState();
    const summary = state.importDialog.ontologyPreview;
    if (
      !state.importDialog.isOpen ||
      !state.importDialog.folderReview ||
      summary?.root !== root ||
      summary.truncated
    )
      return false;
    const proposal = summary.candidates[0];
    if (!proposal) return false;
    const preview = this.reviewOrganization(proposal.id);
    const previewVersion = this.requestVersion;
    await preview;
    return previewVersion === this.requestVersion;
  }

  async reviewOrganization(candidateId: string): Promise<void> {
    const state = useSetStudioStore.getState();
    state.applyFolderOntologyCandidate(candidateId);
    await this.openImportPreview('regex');
  }

  /** Defer final teardown through StrictMode's synchronous cleanup/remount pair. */
  retainFolderReview(): () => void {
    this.folderReviewViews += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.folderReviewViews -= 1;
      queueMicrotask(() => {
        const dialog = useSetStudioStore.getState().importDialog;
        if (this.folderReviewViews === 0 && dialog.isOpen && dialog.folderReview)
          this.cancelReview();
      });
    };
  }

  cancelReview(): void {
    this.activeFolderRequest?.abort();
    this.checkedReviewPreview = null;
    useSetStudioStore.getState().closeImportDialog();
  }

  /**
   * The header-checking preview a folder review just completed, kept so
   * "Open set" need not read every header a second time.
   */
  private rememberCheckedReviewPreview(
    mode: StudioImportMode,
    requestId: number,
    request: { request: StudioImportPreviewRequest },
  ): void {
    const state = useSetStudioStore.getState();
    const dialog = state.importDialog;
    const candidate = dialog.selectedCandidateId
      ? state.importCandidates[dialog.selectedCandidateId]
      : null;
    if (
      mode !== 'regex' ||
      !dialog.folderReview ||
      request.request.discoverySampleHeaders !== true ||
      requestId !== this.requestVersion ||
      !candidate
    )
      return;
    this.checkedReviewPreview = {
      requestKey: JSON.stringify(request),
      requestId,
      candidate,
      completedAtMs: Date.now(),
    };
  }

  /**
   * Open the reviewed draft as the set.
   *
   * The folder is normally scanned once more first, and the set is opened
   * only if the files and their assignments are the ones reviewed ("The
   * files changed since the preview"). That re-scan is skipped in one case:
   * the draft on screen came from a preview that read every image header
   * (the grid check), for exactly the request "Open set" would send, no
   * request or edit has been made since, and it finished less than
   * {@link REVIEW_PREVIEW_REUSE_MS} ago. Reading every header again would
   * repeat the whole audit for no new information: that preview opened each
   * file moments ago. Any other draft (no header check, an older preview, a
   * changed field) is re-scanned and compared as before.
   */
  async confirmReview(): Promise<void> {
    const state = useSetStudioStore.getState();
    const before = state.importDialog.selectedCandidateId
      ? state.importCandidates[state.importDialog.selectedCandidateId]
      : null;
    if (!state.importDialog.isOpen || !before?.contract.canImport || state.importDialog.isLoading)
      return;
    const checked = this.checkedReviewPreview;
    if (
      checked &&
      checked.candidate === before &&
      checked.requestId === this.requestVersion &&
      checked.requestKey === JSON.stringify(this.buildPreviewRequest('regex')) &&
      Date.now() - checked.completedAtMs <= REVIEW_PREVIEW_REUSE_MS
    ) {
      this.checkedReviewPreview = null;
      state.confirmImportCandidate();
      return;
    }
    const pending = this.openImportPreview('regex');
    const version = this.requestVersion;
    await pending;
    const current = useSetStudioStore.getState();
    if (this.requestVersion !== version || !current.importDialog.isOpen) return;
    const after = current.importDialog.selectedCandidateId
      ? current.importCandidates[current.importDialog.selectedCandidateId]
      : null;
    if (!after?.contract.canImport) return;
    if (JSON.stringify(before.discovery?.groups) !== JSON.stringify(after.discovery?.groups)) {
      current.setImportPreviewError(
        'The files changed since the preview. Scan again and review the new assignments.',
      );
      return;
    }
    current.confirmImportCandidate();
  }
  /**
   * Whether the review reads image headers. The preview is run again so the
   * draft on screen is the one "Open set" would open.
   */
  async setFolderReviewGridCheck(enabled: boolean): Promise<void> {
    this.activeFolderRequest?.abort();
    const state = useSetStudioStore.getState();
    if (state.importDialog.discoverySampleHeaders === enabled) return;
    state.setDiscoverySampleHeaders(enabled);
    const dialog = useSetStudioStore.getState().importDialog;
    if (dialog.discoveryRoot.trim() && dialog.filePattern.trim())
      await this.openImportPreview('regex');
  }

  /**
   * Read the image headers of the set already open and replace what its
   * import audit says (grid, alignment, readiness). The discovery is the one
   * the set was opened with; the lens, member and selection are not touched.
   * A result for a set that was replaced, or whose files no longer match, is
   * dropped.
   */
  async checkActiveSetGrids(): Promise<GridCheckOutcome> {
    const before = useSetStudioStore.getState();
    const setId = before.selection.activeSetId;
    const set = setId ? before.sets[setId] : null;
    const discovery = set?.discoveryRequest;
    if (!setId || !set || !discovery || before.gridCheck.status === 'checking') return 'skipped';
    // Asked for by hand or not, this set's check has now been run.
    this.autoGridChecks.add(discovery);
    const session = before.population.sessionRevision;
    const run = ++this.gridCheckRun;
    // A check still running for another set is not this one's to wait for.
    this.activeGridCheck?.abort();
    const controller = new AbortController();
    this.activeGridCheck = controller;
    const ownsSet = () => {
      const now = useSetStudioStore.getState();
      return (
        now.population.sessionRevision === session &&
        now.selection.activeSetId === setId &&
        now.sets[setId]?.discoveryRequest === discovery
      );
    };
    const owns = () => run === this.gridCheckRun && !controller.signal.aborted && ownsSet();
    // Stopped by the user, or because the set or the Studio went away.
    const ended = (): GridCheckOutcome =>
      controller.signal.aborted && controller.signal.reason === USER_CANCELLED
        ? 'cancelled'
        : 'interrupted';
    before.setGridCheck({ status: 'checking', message: null });
    // Ownership lost (another set, a new session, the Studio left): stop the
    // backend reading headers, which holds the mount's transfer permits.
    const unsubscribeSet = useSetStudioStore.subscribe(() => {
      if (!ownsSet()) controller.abort();
    });
    const unsubscribeMode = useAppModeStore.subscribe((state, previous) => {
      if (state.mode !== previous.mode) controller.abort();
    });
    controller.signal.addEventListener(
      'abort',
      () => {
        // Nothing is being checked any more, whichever set is active now.
        if (run === this.gridCheckRun)
          useSetStudioStore.getState().setGridCheck({ status: 'idle', message: null });
      },
      { once: true },
    );
    try {
      const candidates = await this.invokeWithTicket<BackendStudioImportCandidate[]>(
        'preview_set_studio_imports',
        {
          request: {
            mode: 'regex',
            manifestPath: null,
            discoveryRoot: discovery.root,
            filePattern: discovery.filePattern,
            discoveryMaxDepth: discovery.maxDepth,
            discoveryMaxFiles: discovery.maxFiles,
            discoveryIncludePatterns: discovery.includePatterns.length
              ? discovery.includePatterns
              : null,
            discoveryExcludePatterns: discovery.excludePatterns.length
              ? discovery.excludePatterns
              : null,
            discoveryRequiredRoles: discovery.requiredRoles,
            discoveryRolePatterns: discovery.rolePatterns,
            discoveryDryRun: true,
            discoverySampleHeaders: true,
            tableSourceLabel: null,
            tableHeaders: null,
            tableRows: null,
            tableFilePathColumn: null,
            tableSubjectIdColumn: null,
            tableExcludedColumns: null,
          } satisfies StudioImportPreviewRequest,
        },
        controller,
      );
      if (!owns()) return ended();
      const checked = (Array.isArray(candidates) ? candidates : []).find(
        (candidate) => candidate.mode === 'regex',
      ) as StudioImportCandidate | undefined;
      if (!checked) throw new Error('The check returned no result for this folder.');
      const current = useSetStudioStore.getState().sets[setId];
      if (memberSourcesKey(checked.set) !== memberSourcesKey(current)) {
        useSetStudioStore.getState().setGridCheck({
          status: 'failed',
          message:
            'The files in this folder changed since the set was opened. Open the folder again to check its image grids.',
        });
        return 'failed';
      }
      const state = useSetStudioStore.getState();
      state.applySetAudit(setId, {
        supportLabel: checked.set.supportLabel,
        alignmentClass: checked.set.alignmentClass,
        ingestAudit: checked.set.ingestAudit,
        memberSummaries: checked.set.memberSummaries,
        importContract: checked.contract,
      });
      // The check ran. If the audit it returned still reads as "nobody has
      // read the headers", offering the same check again would do nothing:
      // say that it ran and what it reported instead.
      const audited = useSetStudioStore.getState().sets[setId];
      if (setNeedsGridCheck(audited)) {
        state.setGridCheck({ status: 'failed', message: unansweredCheckMessage(audited) });
        return 'failed';
      }
      state.setGridCheck({ status: 'idle', message: null });
      return 'applied';
    } catch (error) {
      if (!owns()) return ended();
      const timedOut = error instanceof PreviewTimedOutError;
      // Over a remote mount the backend keeps the headers a stopped check
      // had read (audit_remote_discovery_headers), so the next one reads
      // only the rest. A local folder's check starts over.
      const resumes =
        timedOut &&
        !!(
          set.sourceLocation?.label ??
          describeFolderSource(discovery.root, useFileBrowserStore.getState().entries).label
        );
      // A dropped remote session: say that, and offer the way back to it.
      const connectionLost = !timedOut && noteRemoteConnectionFailure(discovery.root, error);
      useSetStudioStore.getState().setGridCheck(
        connectionLost
          ? {
              status: 'failed',
              message:
                'The connection to the remote folder was lost before the image headers were read. Reconnect to check the image grids.',
              connectionLostPath: discovery.root,
            }
          : resumes
          ? {
              status: 'failed',
              message:
                'Reading the image headers took longer than two minutes and was stopped. The headers already read are kept: continue to read the rest.',
              resumable: true,
            }
          : {
              status: 'failed',
              message: timedOut
                ? 'The image grids could not be checked: reading the image headers took longer than two minutes and was stopped.'
                : `The image grids could not be checked: ${formatTauriError(error)}`,
            },
      );
      return 'failed';
    } finally {
      unsubscribeSet();
      unsubscribeMode();
      if (this.activeGridCheck === controller) this.activeGridCheck = null;
    }
  }

  /**
   * Stop the grid check in progress, if any (its result is dropped). This is
   * the user's Cancel: the automatic check does not start again for the set.
   */
  cancelGridCheck(): void {
    this.activeGridCheck?.abort(USER_CANCELLED);
  }

  /**
   * Read the active set's image headers without being asked, when nobody has
   * read them (a folder opened without "Check image grids before opening").
   * Once per opened set: a check that ran, failed or was cancelled by the
   * user is not started again (Retry and "Check image grids" are the user's).
   * One that was interrupted because the set was switched away from, or the
   * Studio was left, starts again when that set is back in the Studio. A set
   * whose review already read the headers is left alone.
   */
  autoCheckActiveSetGrids(): void {
    const state = useSetStudioStore.getState();
    const setId = state.selection.activeSetId;
    const set = setId ? state.sets[setId] : null;
    const discovery = set?.discoveryRequest;
    if (!set || !discovery || !setNeedsGridCheck(set)) return;
    if (this.autoGridChecks.has(discovery) || state.gridCheck.status !== 'idle') return;
    if (useAppModeStore.getState().mode !== 'studio') return;
    void this.checkActiveSetGrids().then((outcome) => {
      if (outcome === 'interrupted') this.autoGridChecks.delete(discovery);
    });
  }

  editFolderReview(field: 'root' | 'pattern' | 'depth' | 'limit', value: string): void {
    this.activeFolderRequest?.abort();
    this.checkedReviewPreview = null;
    const state = useSetStudioStore.getState();
    if (field === 'root') state.setDiscoveryRoot(value);
    if (field === 'pattern') state.setFilePattern(value);
    if (field === 'depth') state.setDiscoveryMaxDepth(value);
    if (field === 'limit') state.setDiscoveryMaxFiles(value);
  }

  async validateTablePreview(): Promise<void> {
    await this.openImportPreview('table');
  }

  async exportDiscoveryNeuroTabs(
    candidate: StudioImportCandidate,
  ): Promise<StudioDiscoveryPromotionResult> {
    const outputDir = discoveryExportDirectory(candidate);
    if (!outputDir) {
      throw new Error('NeuroTabs export is available only for local discovery roots.');
    }

    return this.transport.invoke<StudioDiscoveryPromotionResult>('promote_discovery_to_neurotabs', {
      request: {
        candidate: candidate as BackendStudioImportCandidate,
        outputDir,
      },
    });
  }

  private async invokePreview<T>(command: string, args: Record<string, unknown>): Promise<T> {
    this.activeFolderRequest?.abort();
    if (!useSetStudioStore.getState().importDialog.folderReview)
      return this.transport.invoke<T>(command, args);
    const controller = new AbortController();
    this.activeFolderRequest = controller;
    try {
      return await this.invokeWithTicket<T>(command, args, controller);
    } finally {
      if (this.activeFolderRequest === controller) this.activeFolderRequest = null;
    }
  }

  /**
   * Run a preview command under a cancellation ticket: aborting `controller`
   * stops the backend's work (further header reads included), not only the
   * wait for it. The ticket lives {@link PREVIEW_TICKET_LIFETIME_MS}; the
   * backend ends the command itself at that deadline, which is reported as a
   * {@link PreviewTimedOutError} rather than as a cancellation.
   */
  private async invokeWithTicket<T>(
    command: string,
    args: Record<string, unknown>,
    controller: AbortController,
  ): Promise<T> {
    const ticket = {
      id: crypto.randomUUID(),
      expiresAtMs: Date.now() + PREVIEW_TICKET_LIFETIME_MS,
    };
    const cancel = () => {
      void this.transport.invoke('cancel_population_sample', { ticket }).catch(() => {});
    };
    // Aborted before the command was sent: the backend keeps the tombstone
    // and refuses to start it.
    if (controller.signal.aborted) cancel();
    else controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      return await this.transport.invoke<T>(command, { ...args, ticket });
    } catch (error) {
      if (
        !controller.signal.aborted &&
        tauriErrorCode(error) === TICKET_ENDED_CODE &&
        // The backend's deadline is its own clock's: allow it a second.
        Date.now() >= ticket.expiresAtMs - 1_000
      )
        throw new PreviewTimedOutError();
      throw error;
    } finally {
      controller.signal.removeEventListener('abort', cancel);
    }
  }

  private buildPreviewRequest(mode: StudioImportMode): { request: StudioImportPreviewRequest } {
    const dialog = useSetStudioStore.getState().importDialog;
    const wizard = dialog.tsvWizard;
    return {
      request: {
        mode,
        manifestPath: mode === 'manifest' ? dialog.manifestPath : null,
        discoveryRoot: mode === 'regex' ? dialog.discoveryRoot : null,
        filePattern: mode === 'regex' ? dialog.filePattern : null,
        discoveryMaxDepth: mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxDepth) : null,
        discoveryMaxFiles: mode === 'regex' ? parsePositiveInteger(dialog.discoveryMaxFiles) : null,
        discoveryIncludePatterns: null,
        discoveryExcludePatterns: null,
        discoveryRequiredRoles: mode === 'regex' ? dialog.discoveryRequiredRoles : null,
        discoveryRolePatterns: mode === 'regex' ? dialog.discoveryRolePatterns : null,
        discoveryDryRun: mode === 'regex' ? true : null,
        discoverySampleHeaders: mode === 'regex' ? dialog.discoverySampleHeaders : null,
        tableSourceLabel: mode === 'table' ? dialog.tsvWizard.tsvPath || 'pasted table' : null,
        tableHeaders: mode === 'table' ? wizard.headers : null,
        tableRows: mode === 'table' ? wizard.rows : null,
        tableFilePathColumn: mode === 'table' ? wizard.columnMapping.filePathColumn : null,
        tableSubjectIdColumn: mode === 'table' ? wizard.columnMapping.subjectIdColumn : null,
        tableExcludedColumns: mode === 'table' ? wizard.columnMapping.excludedColumns : null,
      },
    };
  }

  private buildFolderOntologyRequest(): StudioFolderOntologyPreviewRequest {
    const dialog = useSetStudioStore.getState().importDialog;
    return {
      root: dialog.discoveryRoot,
      maxDepth: parsePositiveInteger(dialog.discoveryMaxDepth),
      maxFiles: parsePositiveInteger(dialog.discoveryMaxFiles),
      includePatterns: [],
      excludePatterns: [],
    };
  }
}

/**
 * The current study holds something a newly opened set would discard: a
 * saved recipe, a group the user saved, a filter in force, Population work
 * (groups, mask, participants, a selection or its history, an inference, a
 * pinned probe, a relationship, a response order), a background the user
 * chose for this set, or a computed map among the recent artifacts. Opening
 * a folder then stops at its review instead of replacing the study unasked.
 *
 * `bootstrapStudio` resets all of these. Not counted: what the Studio writes
 * by itself (the session revision, the hover probe, the frame in focus, the
 * view a saved calculation restored, the member images it showed) and the
 * Inspect/Montage arrangement, which is a view and not work.
 */
function studyHoldsWork(): boolean {
  const state = useSetStudioStore.getState();
  const setId = state.selection.activeSetId;
  const set = setId ? state.sets[setId] : null;
  if (!set) return false;
  return (
    state.savedRecipes.length > 0 ||
    state.activeDesignFilters.length > 0 ||
    set.savedCohortIds.some((id) => {
      const cohort = state.cohorts[id];
      return !!cohort && !!cohort.originKind && cohort.originKind !== 'imported';
    }) ||
    populationHoldsWork(state.population) ||
    state.studioBackground?.setId === setId ||
    state.artifactHistory.some((artifact) => artifact.bindingKind === 'derived_field')
  );
}

/** The parts of the Population state a user authors, against their initial values. */
function populationHoldsWork(population: PopulationState): boolean {
  const authored = (value: PopulationState) =>
    JSON.stringify([
      value.inference,
      value.partition,
      value.partitionPast,
      value.presentation.order,
      value.participants,
      value.mask,
      value.working,
      value.referenceMode,
      value.pinnedProbe,
      value.relationship,
      value.selectionPast,
      value.selectionFuture,
    ]);
  return authored(population) !== authored(initialPopulationState());
}

/** What a check that ran but answered nothing reported, in the audit's own words. */
function unansweredCheckMessage(set: SpatialFieldSetSummary | null | undefined): string {
  const audit = set?.ingestAudit ?? null;
  const issues = audit?.join?.issueDetails ?? [];
  const said =
    issues[issues.length - 1]?.message?.trim() ||
    audit?.notes?.[audit.notes.length - 1]?.trim() ||
    (audit?.support?.supportLabel ? `the audit reported "${audit.support.supportLabel}"` : '');
  return `The image headers were read, but the check did not say whether the images share one grid${said ? `: ${said}` : '.'}`;
}

/** Members and the files bound to them, without what a header check adds. */
function memberSourcesKey(
  set: Pick<SpatialFieldSetSummary, 'memberIds' | 'memberSummaries'>,
): string {
  return JSON.stringify([
    set.memberIds,
    set.memberSummaries.map((member) => [
      member.id,
      member.sourcePath ?? null,
      (member.bindings ?? []).map((binding) => [
        binding.role,
        binding.sourcePath,
        binding.selector,
        binding.availability,
      ]),
    ]),
  ]);
}

export function discoveryExportDirectory(candidate: StudioImportCandidate): string | null {
  const root = candidate.discovery?.root?.trim();
  if (!root || root.includes('://')) {
    return null;
  }
  return root;
}

let instance: SetIngestionService | null = null;

export function getSetIngestionService(): SetIngestionService {
  if (!instance) {
    instance = new SetIngestionService();
  }

  return instance;
}
