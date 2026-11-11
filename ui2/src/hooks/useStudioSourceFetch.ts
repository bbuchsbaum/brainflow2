import { useEffect, useMemo } from 'react';
import { buildPopulationSource } from '@/services/studio/PopulationProbeController';
import {
  getStudioSourceFetchService,
  type StudioSource,
} from '@/services/studio/StudioSourceFetchService';
import { useAppModeStore } from '@/stores/appModeStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useStudioSourceFetchStore } from '@/stores/studioSourceFetchStore';

type StudioState = ReturnType<typeof useSetStudioStore.getState>;

/**
 * The image files Population reads for the active set and image: one per
 * observation in the context, and the mask when one is set. Empty when the
 * set cannot be read yet (that is the readiness notice's to say).
 */
export function populationFetchSources(state: StudioState): StudioSource[] {
  const { source } = buildPopulationSource(state, '');
  if (!source) return [];
  const sources: StudioSource[] = source.members.map((member) => ({
    path: member.sourcePath,
    label: member.memberId,
  }));
  if (source.mask) sources.push({ path: source.mask.sourcePath, label: 'Mask' });
  return sources;
}

/**
 * Whether Population can read its images now. A local set always can, with
 * no backend call. For a set on a remote mount this starts the fetch of the
 * images that are not on this computer and answers false until it is done;
 * StudioSourceFetchNotice shows where it is.
 */
export function usePopulationSourcesLocal(): boolean {
  const hasRemoteMount = useFileBrowserStore((state) =>
    state.entries.some((entry) => entry.mountSource?.kind === 'remote'),
  );
  // The backend refused an image the Files panel shows no remote folder for
  // (a set restored before its folder was reconnected, or a root removed
  // from Files): the service asks the backend instead.
  const refused = useStudioSourceFetchStore((state) => state.refused);
  const remote = hasRemoteMount || refused;
  // A string, so an unchanged list is an unchanged value.
  const key = useSetStudioStore((state) =>
    remote ? JSON.stringify(populationFetchSources(state)) : '',
  );
  const revision = useStudioSourceFetchStore((state) => state.revision);
  const attempt = useStudioSourceFetchStore((state) => state.attempt);
  const idle = useStudioSourceFetchStore((state) => state.phase === 'idle');
  const inStudio = useAppModeStore((state) => state.mode === 'studio');
  const sources = useMemo<StudioSource[]>(() => (key ? JSON.parse(key) : []), [key]);
  const local = useMemo(
    () => !sources.length || getStudioSourceFetchService().isLocal(sources),
    // `revision` changes when a fetch lands; the mounts when one connects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, revision, remote],
  );
  useEffect(() => {
    // Only when no fetch is running or waiting on the user (stopped, failed,
    // or a large one not agreed to): those are the notice's to continue. The
    // fetch belongs to the service, so leaving the lens does not stop it;
    // leaving the Studio does, and it is not started again from outside it.
    if (local || !idle || !inStudio) return;
    getStudioSourceFetchService()
      .pending(sources)
      ?.catch(() => undefined);
    // `revision` and `attempt` re-arm this after a fetch that ended without
    // the images becoming local and without leaving `idle` (one that was
    // aborted): otherwise nothing would ask again.
  }, [local, sources, idle, inStudio, revision, attempt]);
  return local;
}
