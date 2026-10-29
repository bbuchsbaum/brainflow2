import React from "react";
import {getHostCapabilities} from "@/services/transport";
import { VscFolderOpened, VscRemote, VscFile } from "react-icons/vsc";
import {
  RecentLocationsList,
  PinnedLocationsList,
} from "./RecentLocationsList";
import { DropTargetFooter } from "./DropTargetFooter";
import { Button, Notice } from "@/components/ui/bf";
import "./FilesStartPanel.css";

interface FilesStartPanelProps {
  shortcutLabel: string;
  pending: boolean;
  errorMessage: string | null;
  onMountLocal: () => void;
  onMountRemote: () => void;
  onOpenFile: () => void;
}

export const FilesStartPanel: React.FC<FilesStartPanelProps> = ({
  shortcutLabel,
  pending,
  errorMessage,
  onMountLocal,
  onMountRemote,
  onOpenFile,
}) => {
  return (
    <div className="files-start-panel" role="region" aria-label="Files start">
      <p className="files-start-kicker">No directory mounted</p>
      <p className="files-start-message">
        Mount a directory or open a single file to start browsing neuroimaging
        data.
      </p>

      <ul className="files-start-commands">
        <li>
          <Button
            variant="primary"
            size="sm"
            className="files-start-command w-full justify-start"
            onClick={onMountLocal}
            disabled={pending || !getHostCapabilities().nativePaths}
            icon={<VscFolderOpened className="files-start-command-icon" />}
          >
            <span className="files-start-command-label">Mount directory</span>
            <span className="files-start-command-shortcut">
              {shortcutLabel}
            </span>
          </Button>
        </li>
        <li>
          <Button
            variant="secondary"
            size="sm"
            className="files-start-command w-full justify-start"
            onClick={onMountRemote}
            disabled={pending || !getHostCapabilities().remoteMounts}
            icon={<VscRemote className="files-start-command-icon" />}
          >
            <span className="files-start-command-label">Mount remote (SSH)…</span>
          </Button>
        </li>
        <li>
          <Button
            variant="secondary"
            size="sm"
            className="files-start-command w-full justify-start"
            onClick={onOpenFile}
            disabled={pending}
            icon={<VscFile className="files-start-command-icon" />}
          >
            <span className="files-start-command-label">Open file…</span>
          </Button>
        </li>
      </ul>

      {errorMessage && (
        <Notice severity="danger" className="files-start-error">
          {errorMessage}
        </Notice>
      )}

      {!getHostCapabilities().nativePaths && <p>Open an image from your device. Folder mounts and SSH connections require the desktop app.</p>}
      <PinnedLocationsList
        onActivate={(item) => {
          if (item.mountSource.kind === "remote") {
            onMountRemote();
          } else {
            onMountLocal();
          }
        }}
      />

      <RecentLocationsList
        onMountLocal={onMountLocal}
        onMountRemote={() => onMountRemote()}
      />

      <DropTargetFooter />
    </div>
  );
};
