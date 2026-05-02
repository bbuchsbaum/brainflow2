import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisArtifact } from '@brainflow/api';

const mockTransport = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const mockFileLoadingService = vi.hoisted(() => ({
  loadFile: vi.fn(),
}));

const mockSurfaceLoadingService = vi.hoisted(() => ({
  loadSurfaceFile: vi.fn(),
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => mockTransport,
}));

vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => mockFileLoadingService,
}));

vi.mock('@/services/SurfaceLoadingService', () => ({
  getSurfaceLoadingService: () => mockSurfaceLoadingService,
}));

import { AnalysisService } from '../AnalysisService';

describe('AnalysisService', () => {
  beforeEach(() => {
    mockTransport.invoke.mockReset();
    mockFileLoadingService.loadFile.mockReset();
    mockSurfaceLoadingService.loadSurfaceFile.mockReset();
  });

  it('lists analyses through transport', async () => {
    mockTransport.invoke.mockResolvedValue([{ id: 'builtin-copy-volume' }]);

    const result = await new AnalysisService().listAnalyses();

    expect(result).toEqual([{ id: 'builtin-copy-volume' }]);
    expect(mockTransport.invoke).toHaveBeenCalledWith('list_analyses');
  });

  it('opens volume artifacts through FileLoadingService', async () => {
    const artifact: AnalysisArtifact = {
      kind: 'volume',
      name: 'Copied volume',
      path: '/tmp/copied-volume.nii.gz',
      metadata: {},
    };

    await new AnalysisService().openArtifact(artifact);

    expect(mockFileLoadingService.loadFile).toHaveBeenCalledWith(
      '/tmp/copied-volume.nii.gz',
      'programmatic',
      'add-layer'
    );
  });

  it('opens surface artifacts through SurfaceLoadingService', async () => {
    const artifact: AnalysisArtifact = {
      kind: 'surface',
      name: 'Derived surface',
      path: '/tmp/derived.surf.gii',
      metadata: {},
    };

    await new AnalysisService().openArtifact(artifact);

    expect(mockSurfaceLoadingService.loadSurfaceFile).toHaveBeenCalledWith({
      path: '/tmp/derived.surf.gii',
      displayName: 'Derived surface',
    });
  });
});
