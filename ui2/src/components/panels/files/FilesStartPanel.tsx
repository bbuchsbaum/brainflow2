import React from "react";
import { VscFolderOpened, VscRemote, VscFile } from "react-icons/vsc";
import {
  RecentLocationsList,
  PinnedLocationsList,
} from "./RecentLocationsList";
import { DropTargetFooter } from "./DropTargetFooter";
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
          <button
            type="button"
            className="files-start-command files-start-command--primary"
            onClick={onMountLocal}
            disabled={pending}
          >
            <VscFolderOpened
              className="files-start-command-icon"
              aria-hidden="true"
            />
            <span className="files-start-command-label">Mount Directory</span>
            <span className="files-start-command-shortcut">
              {shortcutLabel}
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="files-start-command"
            onClick={onMountRemote}
            disabled={pending}
          >
            <VscRemote
              className="files-start-command-icon"
              aria-hidden="true"
            />
            <span className="files-start-command-label">
              Mount Remote (SSH)…
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="files-start-command"
            onClick={onOpenFile}
            disabled={pending}
          >
            <VscFile className="files-start-command-icon" aria-hidden="true" />
            <span className="files-start-command-label">Open File…</span>
          </button>
        </li>
      </ul>

      {errorMessage && (
        <p className="files-start-error" role="status">
          {errorMessage}
        </p>
      )}

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
