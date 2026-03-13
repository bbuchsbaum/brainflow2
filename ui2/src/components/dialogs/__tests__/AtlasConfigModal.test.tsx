import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AtlasConfigModal } from '../AtlasConfigModal';
import {
  AtlasCategory,
  AtlasDataType,
  AtlasSource,
  type AtlasCatalogEntry,
} from '@/types/atlas';

const { mockValidateConfig, mockLoadAtlas } = vi.hoisted(() => ({
  mockValidateConfig: vi.fn(),
  mockLoadAtlas: vi.fn(),
}));

vi.mock('@/services/AtlasService', () => ({
  AtlasService: {
    validateConfig: mockValidateConfig,
    loadAtlas: mockLoadAtlas,
  },
}));

const atlasFixture: AtlasCatalogEntry = {
  id: 'aal3',
  name: 'AAL3',
  description: 'Automated anatomical labeling atlas',
  source: AtlasSource.BuiltIn,
  category: AtlasCategory.WholeBrain,
  allowed_spaces: [
    {
      id: 'MNI152NLin6Asym',
      name: 'MNI152NLin6Asym',
      description: 'Default MNI space',
      data_type: AtlasDataType.Volume,
    },
  ],
  resolutions: [
    {
      value: '1mm',
      description: 'High resolution',
    },
  ],
  is_favorite: false,
  is_cached: false,
  citation: 'Example citation',
  download_size_mb: 64,
};

describe('AtlasConfigModal', () => {
  beforeEach(() => {
    mockValidateConfig.mockReset();
    mockLoadAtlas.mockReset();
  });

  it('loads an atlas and reports success through the shared modal shell', async () => {
    mockValidateConfig.mockResolvedValue(true);
    mockLoadAtlas.mockResolvedValue({
      success: true,
      atlas_metadata: {
        id: atlasFixture.id,
        name: atlasFixture.name,
        description: atlasFixture.description,
        n_regions: 120,
        space: 'MNI152NLin6Asym',
        resolution: '1mm',
      },
      volume_handle: 'vol-123',
    });

    const onClose = vi.fn();
    const onLoad = vi.fn();
    render(<AtlasConfigModal isOpen onClose={onClose} atlas={atlasFixture} onLoad={onLoad} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('AAL3')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockValidateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          atlas_id: 'aal3',
          space: 'MNI152NLin6Asym',
          resolution: '1mm',
        }),
        expect.any(AbortSignal)
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load Atlas' }));
    });

    await waitFor(() => {
      expect(mockLoadAtlas).toHaveBeenCalledWith(
        expect.objectContaining({
          atlas_id: 'aal3',
          space: 'MNI152NLin6Asym',
          resolution: '1mm',
        }),
        expect.any(AbortSignal)
      );
    });

    expect(await screen.findByText('Atlas Loaded Successfully')).toBeInTheDocument();
    expect(screen.getByText('vol-123')).toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces validation failures and keeps load disabled', async () => {
    mockValidateConfig.mockResolvedValue(false);
    mockLoadAtlas.mockResolvedValue({
      success: true,
    });

    const onClose = vi.fn();
    render(<AtlasConfigModal isOpen onClose={onClose} atlas={atlasFixture} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Invalid configuration')).toBeInTheDocument();

    const loadButton = screen.getByRole('button', { name: 'Load Atlas' });
    expect(loadButton).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockLoadAtlas).not.toHaveBeenCalled();
  });
});
