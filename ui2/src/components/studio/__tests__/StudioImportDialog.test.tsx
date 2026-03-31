import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioImportDialog } from '../StudioImportDialog';
import { useSetStudioStore } from '@/stores/setStudioStore';

// Mock the ingestion service so Refresh doesn't hit the backend
vi.mock('@/services/studio/SetIngestionService', () => ({
  getSetIngestionService: () => ({
    openImportPreview: vi.fn(),
    validateTablePreview: vi.fn(),
  }),
}));

describe('StudioImportDialog', () => {
  beforeEach(() => {
    useSetStudioStore.setState(useSetStudioStore.getInitialState());
  });

  function openDialog(mode: 'manifest' | 'regex' | 'table' = 'regex') {
    useSetStudioStore.getState().openImportDialog(mode);
    // force isOpen since openImportDialog only switches mode when already open
    useSetStudioStore.setState({ importDialog: { ...useSetStudioStore.getState().importDialog, isOpen: true } });
  }

  it('renders nothing when closed', () => {
    const { container } = render(<StudioImportDialog />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders dialog title based on mode', () => {
    openDialog('regex');
    render(<StudioImportDialog />);
    expect(screen.getByText('Discover Files By Regex')).toBeInTheDocument();
  });

  it('shows all three tab labels', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);
    expect(screen.getByText('From Table')).toBeInTheDocument();
    expect(screen.getByText('NeuroTabs Manifest')).toBeInTheDocument();
    expect(screen.getByText('Discover Files')).toBeInTheDocument();
  });

  it('switches mode when clicking a tab', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);
    fireEvent.click(screen.getByText('Discover Files'));
    expect(useSetStudioStore.getState().importDialog.mode).toBe('regex');
  });

  it('shows the seed regex candidate with preview data', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    // Label appears in sidebar and preview header — both should exist
    expect(screen.getAllByText('Regex discovery preview')).toHaveLength(2);

    // Preview rows from REGEX_IMPORT_SET
    expect(screen.getByText('sub201')).toBeInTheDocument();
    expect(screen.getByText('sub202')).toBeInTheDocument();

    // Metadata fields (appear in both pills and table header)
    expect(screen.getAllByText('subject').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('diagnosis').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the seed manifest candidate when switching to manifest tab', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getAllByText('NeuroTabs manifest preview')).toHaveLength(2);
    expect(screen.getByText('sub101')).toBeInTheDocument();
  });

  it('renders the footer buttons (Cancel + Import)', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // Regex candidate has warnings, so the label should be "Import For Review"
    expect(screen.getByRole('button', { name: 'Import For Review' })).toBeInTheDocument();
  });

  it('renders "Import For Compare" for a clean manifest candidate', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getByRole('button', { name: 'Import For Compare' })).toBeInTheDocument();
  });

  it('shows readiness banner for clean manifest candidate', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getByText('Studio Ready')).toBeInTheDocument();
    expect(screen.getByText('Ready for compare-centered reading')).toBeInTheDocument();
  });

  it('shows review banner for regex candidate with warnings', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('Deck First')).toBeInTheDocument();
    expect(screen.getByText('Import for review before compare')).toBeInTheDocument();
  });

  it('shows match summary cards', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('Match Summary')).toBeInTheDocument();
    expect(screen.getByText('Template Check')).toBeInTheDocument();
  });

  it('shows import notes when present', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('Import notes')).toBeInTheDocument();
  });

  it('shows discovery root and file pattern inputs in regex mode', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    expect(screen.getByText('Discovery Root')).toBeInTheDocument();
    expect(screen.getByText('File Pattern')).toBeInTheDocument();
    // The store seeds the discoveryRoot value as "."
    expect(screen.getByDisplayValue('.')).toBeInTheDocument();
  });

  it('shows manifest path input in manifest mode', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(screen.getByPlaceholderText('/path/to/study.neurotabs.yaml')).toBeInTheDocument();
  });

  it('calls closeImportDialog when Cancel is clicked', () => {
    openDialog('regex');
    render(<StudioImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });

  it('closes dialog when Import button is clicked', () => {
    openDialog('manifest');
    render(<StudioImportDialog />);

    expect(useSetStudioStore.getState().importDialog.selectedCandidateId).toBeTruthy();
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Import For Compare' }));
    // Dialog should close after confirm
    expect(useSetStudioStore.getState().importDialog.isOpen).toBe(false);
  });
});
