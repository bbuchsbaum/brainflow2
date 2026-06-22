import React from "react";
import { VscCloudUpload } from "react-icons/vsc";

export const DropTargetFooter: React.FC = () => {
  return (
    <div className="files-start-drop" aria-label="Drop target hint">
      <VscCloudUpload className="files-start-drop-icon" aria-hidden="true" />
      <p className="files-start-drop-title">
        Drop a NIfTI / GIfTI file to load
      </p>
    </div>
  );
};
