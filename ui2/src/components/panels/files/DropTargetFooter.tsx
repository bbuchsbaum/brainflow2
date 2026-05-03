import React from 'react';
import { VscCloudUpload } from 'react-icons/vsc';

interface DropTargetFooterProps {
  shortcutLabel: string;
}

export const DropTargetFooter: React.FC<DropTargetFooterProps> = ({ shortcutLabel }) => {
  return (
    <div className="files-start-drop" aria-label="Drop target hint">
      <VscCloudUpload className="files-start-drop-icon" aria-hidden="true" />
      <div className="files-start-drop-body">
        <p className="files-start-drop-title">Drop a NIfTI / GIfTI here to load</p>
        <p className="files-start-drop-hint">
          or press <kbd>{shortcutLabel}</kbd> to mount a directory
        </p>
      </div>
    </div>
  );
};
