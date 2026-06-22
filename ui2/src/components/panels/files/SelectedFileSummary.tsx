import React, { useEffect, useRef, useState } from "react";
import "./SelectedFileSummary.css";
import { getEventBus } from "@/events/EventBus";
import { getTransport } from "@/services/transport";
import type { DisplayOpenIntent } from "@/types/loadIntent";
import { useFileBrowserStore } from "@/stores/fileBrowserStore";
import { inferFileType } from "./shared/inferFileType";
import { FileTypeBadge } from "./shared/FileTypeBadge";

interface SelectedFileSummaryProps {
  selectedPath: string | null;
  selectedNode: {
    name: string;
    type: "file" | "directory";
    size?: number;
  } | null;
}

interface PeekResult {
  dims: number[];
  voxelSize?: number[];
  dtype?: string;
  isFourD?: boolean;
  numTimepoints?: number;
  tr?: number;
}

const PEEK_COMMAND = "peek_volume_metadata";

function formatFileSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
}

function formatDims(dims: number[] | undefined): string {
  if (!dims || dims.length === 0) return "";
  return dims.join(" × ");
}

function formatVoxel(voxelSize: number[] | undefined): string {
  if (!voxelSize || voxelSize.length === 0) return "";
  return `${voxelSize
    .slice(0, 3)
    .map((v) => v.toFixed(2))
    .join(" × ")} mm`;
}

export const SelectedFileSummary: React.FC<SelectedFileSummaryProps> = ({
  selectedPath,
  selectedNode,
}) => {
  const isFourDStored = useFileBrowserStore((state) =>
    selectedPath && state.fourDPaths
      ? state.fourDPaths.has(selectedPath)
      : false,
  );

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peekLoading, setPeekLoading] = useState<boolean>(false);
  const requestIdRef = useRef(0);

  // The probe key is the small set of fields we actually want to
  // re-trigger on. We intentionally exclude `selectedNode` from the dep
  // array so transient store rewrites that swap the node reference
  // without changing identity don't refire the network call.
  const selectedNodeType = selectedNode?.type ?? null;
  const selectedNodeName = selectedNode?.name ?? null;

  useEffect(() => {
    setPeek(null);
    setPeekError(null);

    if (!selectedPath || selectedNodeType !== "file") {
      setPeekLoading(false);
      return;
    }

    const info = inferFileType(selectedPath, false);
    const isProbeable = [
      "nii",
      "niiGz",
      "fourDNii",
      "gii",
      "surfGii",
      "funcGii",
      "mgz",
      "mgh",
    ].includes(info.kind);
    if (!isProbeable) {
      setPeekLoading(false);
      return;
    }

    const myId = ++requestIdRef.current;
    setPeekLoading(true);

    let cancelled = false;
    void (async () => {
      try {
        const result = await getTransport().invoke<PeekResult>(PEEK_COMMAND, {
          path: selectedPath,
        });
        if (cancelled || requestIdRef.current !== myId) return;
        setPeek(result);
        setPeekError(null);
      } catch (error) {
        if (cancelled || requestIdRef.current !== myId) return;
        const message = error instanceof Error ? error.message : String(error);
        setPeekError(message);
        setPeek(null);
      } finally {
        if (!cancelled && requestIdRef.current === myId) {
          setPeekLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      requestIdRef.current += 1;
    };
  }, [selectedPath, selectedNodeType, selectedNodeName]);

  if (!selectedPath || !selectedNode || selectedNode.type !== "file") {
    return null;
  }

  const isFourD = isFourDStored || Boolean(peek?.isFourD);
  const typeInfo = inferFileType(selectedPath, false, { isFourD });

  function fireOpen(intent: DisplayOpenIntent) {
    getEventBus().emit("filebrowser.file.open", {
      path: selectedPath as string,
      intent,
    });
  }

  const dimsStr = formatDims(peek?.dims);
  const voxelStr = formatVoxel(peek?.voxelSize);
  const sizeStr = formatFileSize(selectedNode.size);

  return (
    <div
      className="fb-selected-summary"
      role="region"
      aria-label="Selected file summary"
    >
      <div className="fb-selected-row">
        <FileTypeBadge info={typeInfo} />
        <span className="fb-selected-name" title={selectedPath}>
          {selectedNode.name}
        </span>
      </div>

      <div className="fb-selected-meta">
        {peekLoading && (
          <span className="fb-selected-meta-item fb-selected-meta-pending">
            Probing…
          </span>
        )}
        {!peekLoading && peek && dimsStr && (
          <span className="fb-selected-meta-item" title="Dimensions">
            {dimsStr}
          </span>
        )}
        {!peekLoading && peek && voxelStr && (
          <span className="fb-selected-meta-item" title="Voxel size">
            {voxelStr}
          </span>
        )}
        {!peekLoading && peek?.dtype && (
          <span className="fb-selected-meta-item" title="Data type">
            {peek.dtype}
          </span>
        )}
        {!peekLoading && isFourD && peek?.numTimepoints && (
          <span className="fb-selected-meta-item" title="Time points">
            {peek.numTimepoints}t
          </span>
        )}
        {/* Show size whenever there are no dimensions to display — covers a
            failed probe and the remote-not-yet-cached stub (empty dims). */}
        {!peekLoading && !dimsStr && sizeStr && (
          <span className="fb-selected-meta-item" title="File size">
            {sizeStr}
          </span>
        )}
        {!peekLoading && !dimsStr && !sizeStr && (
          <span className="fb-selected-meta-item">{typeInfo.description}</span>
        )}
      </div>

      {peekError && !peek && (
        <p className="fb-selected-fallback" role="status">
          Quick preview unavailable.
        </p>
      )}

      <div className="fb-selected-actions">
        <button
          type="button"
          className="fb-selected-button fb-selected-button--primary"
          onClick={() => fireOpen("default")}
        >
          Load
        </button>
        <button
          type="button"
          className="fb-selected-button"
          onClick={() => fireOpen("add-layer")}
        >
          Add Layer
        </button>
      </div>
    </div>
  );
};
