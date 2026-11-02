import type { SegmentationSessionInfo, SegmentationSessionSetup, SegmentationStroke } from '@brainflow/api';
export const document = { workspaceId: 'synthetic-view', workspaceInstance: 'opaque-native-test' };
export const setup: Omit<SegmentationSessionSetup, 'workspaceId' | 'workspaceInstance'> = {
  referenceVolumeId: 'synthetic-reference', normalAxis: 1, secondaryVolumeId: null,
  registration: { status: 'withoutSecondary', reason: 'Synthetic unit fixture has one contrast.' },
  identity: { subject: 'synthetic-01', session: '01', hemisphere: 'left', rater: 'rater-a', blind: true },
  labels: [{ id: 1, name: 'ROI A', abbreviation: 'A', color: [196, 105, 46], parent: null }, { id: 2, name: 'ROI B', abbreviation: 'B', color: [38, 156, 180], parent: null }],
};
export function info(revision = 0): SegmentationSessionInfo {
  return { labelVolumeId: 'synthetic-labels', paletteId: 12, renderError: null, snapshot: {
    ...document, sessionId: 'synthetic-session', referenceVolumeId: setup.referenceVolumeId, secondaryVolumeId: null,
    revision, labelRevision: revision, identity: setup.identity, dimensions: [5, 3, 7], normalAxis: 1,
    voxelToWorld: [.4, 0, 0, 0, 0, 2, 0, 0, 0, 0, .4, 0, 10, -20, 5, 1],
    labels: setup.labels.map((definition, index) => ({ definition, locked: false, complete: false, voxels: index === 0 && revision > 0 ? 5 : 0, mm3: index === 0 && revision > 0 ? 1.6 : 0, sliceVoxels: index === 0 && revision > 0 ? [0, 5, 0] : [0, 0, 0] })),
    registration: setup.registration, sourceHeaderOriginal: true, undo: revision > 0 ? 'Brush · ROI A' : null, redo: null,
  }};
}
export const stroke: Omit<SegmentationStroke, 'owner'> = { labelId: 1, sliceIndex: 1, tool: 'brush', radiusMm: .41, pointsWorld: [[10.8, -18, 6.2]], paintOver: 'unlocked' };
