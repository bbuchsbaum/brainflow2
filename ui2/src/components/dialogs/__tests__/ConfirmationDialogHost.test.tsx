import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmationDialogHost } from '../ConfirmationDialogHost';
import { getConfirmationService } from '@/services/ConfirmationService';
import { useConfirmationDialogStore } from '@/stores/confirmationDialogStore';

describe('ConfirmationDialogHost', () => {
  beforeEach(() => {
    useConfirmationDialogStore.getState().clearAll();
    useConfirmationDialogStore.setState({
      hostMounted: false,
      activeRequest: null,
      queuedRequests: [],
      nextId: 1,
    });
  });

  afterEach(() => {
    useConfirmationDialogStore.getState().clearAll();
  });

  it('renders destructive removal confirmations with explicit title and action styling', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    let pending: Promise<boolean>;
    await act(async () => {
      pending = getConfirmationService().confirmVolumeLayerRemoval('Layer One');
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove Volume Layer')).toBeInTheDocument();
    expect(screen.getByText('Remove layer "Layer One"?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('bg-destructive');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });

    await expect(pending!).resolves.toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps non-destructive confirms on the default action styling', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    let pending: Promise<boolean>;
    await act(async () => {
      pending = getConfirmationService().confirmAtlasSurfaceProjection('Atlas A');
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('bg-primary');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    });

    await expect(pending!).resolves.toBe(true);
  });

  it('resolves prompt requests with the entered value', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    let pending: Promise<string | null>;
    await act(async () => {
      pending = getConfirmationService().promptLayoutRename('Current Layout');
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Rename Layout')).toBeInTheDocument();
    const input = screen.getByDisplayValue('Current Layout');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Renamed Layout' } });
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    });

    await expect(pending!).resolves.toBe('Renamed Layout');
  });

  it('dismisses confirm requests with Escape', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    let pending: Promise<boolean>;
    await act(async () => {
      pending = getConfirmationService().confirmVolumeLayerRemoval('Layer One');
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    await expect(pending!).resolves.toBe(false);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('locks body scroll, traps focus, and restores focus after closing', async () => {
    render(
      <>
        <button type="button">Launch source</button>
        <ConfirmationDialogHost />
      </>
    );
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    const launchButton = screen.getByRole('button', { name: 'Launch source' });
    launchButton.focus();
    expect(launchButton).toHaveFocus();

    let pending: Promise<boolean>;
    await act(async () => {
      pending = getConfirmationService().confirmVolumeLayerRemoval('Layer One');
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    const confirmButton = screen.getByRole('button', { name: 'Remove' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });

    await waitFor(() => {
      expect(confirmButton).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirmButton).toHaveFocus();

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    await expect(pending!).resolves.toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe('');
    expect(launchButton).toHaveFocus();
  });

  it('does not dismiss alert dialogs on backdrop click', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    await act(async () => {
      getConfirmationService().showError('Something went wrong');
    });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('queues requests and shows the next dialog after resolving the first', async () => {
    render(<ConfirmationDialogHost />);
    await waitFor(() => {
      expect(useConfirmationDialogStore.getState().hostMounted).toBe(true);
    });

    let firstPending: Promise<boolean>;
    let secondPending: Promise<boolean>;
    await act(async () => {
      firstPending = getConfirmationService().confirmVolumeLayerRemoval('Layer One');
      secondPending = getConfirmationService().confirmSurfaceRemoval('Surface Two');
    });

    expect(await screen.findByText('Remove layer "Layer One"?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await expect(firstPending!).resolves.toBe(true);

    expect(await screen.findByText('Remove surface "Surface Two"?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await expect(secondPending!).resolves.toBe(true);
  });
});
