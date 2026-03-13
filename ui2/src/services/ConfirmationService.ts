import {
  useConfirmationDialogStore,
  type ConfirmationDialogTone,
} from '@/stores/confirmationDialogStore';

export interface ConfirmationRequest {
  message: string;
  defaultValue?: boolean;
  tone?: ConfirmationDialogTone;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptRequest {
  message: string;
  defaultValue?: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmationDialogTone;
}

export class ConfirmationService {
  private hasDialogHost(): boolean {
    return useConfirmationDialogStore.getState().hostMounted;
  }

  private enqueueHostedDialog(
    request: {
      kind: 'alert' | 'confirm' | 'prompt';
      tone?: ConfirmationDialogTone;
      message: string;
      fallbackValue: boolean | string | null | undefined;
      title?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      defaultValue?: string;
    }
  ): Promise<boolean | string | null | undefined> {
    return new Promise((resolve) => {
      useConfirmationDialogStore.getState().enqueueRequest({
        ...request,
        resolve,
      });
    });
  }

  async confirm({
    message,
    defaultValue = false,
    tone,
    title,
    confirmLabel,
    cancelLabel,
  }: ConfirmationRequest): Promise<boolean> {
    if (this.hasDialogHost()) {
      const result = await this.enqueueHostedDialog({
        kind: 'confirm',
        tone,
        message,
        fallbackValue: defaultValue,
        title,
        confirmLabel,
        cancelLabel,
      });
      return result === true;
    }

    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }

    return defaultValue;
  }

  async prompt({
    message,
    defaultValue = '',
    title,
    confirmLabel,
    cancelLabel,
    tone,
  }: PromptRequest): Promise<string | null> {
    if (this.hasDialogHost()) {
      const result = await this.enqueueHostedDialog({
        kind: 'prompt',
        message,
        defaultValue,
        fallbackValue: null,
        title,
        confirmLabel,
        cancelLabel,
        tone,
      });
      return typeof result === 'string' ? result : null;
    }

    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      return window.prompt(message, defaultValue);
    }

    return null;
  }

  alert(message: string): void {
    if (this.hasDialogHost()) {
      void this.enqueueHostedDialog({
        kind: 'alert',
        message,
        fallbackValue: undefined,
      });
      return;
    }

    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message);
    }
  }

  async confirmSurfaceRemoval(surfaceName?: string): Promise<boolean> {
    const label = surfaceName?.trim() ? `Remove surface "${surfaceName}"?` : 'Remove this surface?';
    return this.confirm({
      message: label,
      tone: 'destructive',
      title: 'Remove Surface',
      confirmLabel: 'Remove',
    });
  }

  async confirmSurfaceLayerRemoval(layerName: string): Promise<boolean> {
    return this.confirm({
      message: `Remove layer "${layerName}"?`,
      tone: 'destructive',
      title: 'Remove Surface Layer',
      confirmLabel: 'Remove',
    });
  }

  async confirmVolumeLayerRemoval(layerName: string): Promise<boolean> {
    return this.confirm({
      message: `Remove layer "${layerName}"?`,
      tone: 'destructive',
      title: 'Remove Volume Layer',
      confirmLabel: 'Remove',
    });
  }

  async confirmAtlasSurfaceProjection(atlasName: string): Promise<boolean> {
    return this.confirm({
      message:
        `"${atlasName}" — Project onto active surface?\n\n` +
        'OK = Project to surface\n' +
        'Cancel = Load as volume overlay',
    });
  }

  async confirmLayoutDeletion(layoutName: string): Promise<boolean> {
    return this.confirm({
      message: `Delete saved layout '${layoutName}'?`,
      tone: 'destructive',
      title: 'Delete Layout',
      confirmLabel: 'Delete',
    });
  }

  async promptLayoutSaveName(suggestedName: string): Promise<string | null> {
    return this.prompt({
      message: 'Save current layout as:',
      defaultValue: suggestedName,
      title: 'Save Layout',
      confirmLabel: 'Save',
    });
  }

  async promptLayoutRename(currentName: string): Promise<string | null> {
    return this.prompt({
      message: `Rename layout '${currentName}' to:`,
      defaultValue: currentName,
      title: 'Rename Layout',
      confirmLabel: 'Rename',
    });
  }

  showError(message: string): void {
    this.alert(message);
  }
}

let confirmationServiceInstance: ConfirmationService | null = null;

export function getConfirmationService(): ConfirmationService {
  if (!confirmationServiceInstance) {
    confirmationServiceInstance = new ConfirmationService();
  }

  return confirmationServiceInstance;
}
