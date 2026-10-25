import { getSetStudioService } from '@/services/studio/SetStudioService';
import React from "react";
import "./FileTreeRow.css";
import type { NodeRendererProps } from "react-arborist";
import {
  VscChevronRight,
  VscChevronDown,
  VscFolder,
  VscFolderOpened,
  VscFile,
  VscJson,
  VscTable,
  VscMarkdown,
  VscFileCode,
  VscFileBinary,
  VscLoading,
} from "react-icons/vsc";
import { useFileBrowserStore } from "@/stores/fileBrowserStore";
import { useIsLoading } from "@/stores/loadingQueueStore";
import { getEventBus } from "@/events/EventBus";
import { getTransport } from "@/services/transport";
import { getImageSetService } from "@/services/ImageSetService";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import type { ContextMenuItem } from "@/stores/contextMenuStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBidsStore } from "@/stores/bidsStore";
import {
  FILE_DRAG_MIME,
  setActiveDragData,
  clearActiveDragData,
} from "@/utils/layerDrag";
import type { DragFileData, MountSource } from "@/types/filesystem";
import type { DisplayOpenIntent } from "@/types/loadIntent";
import { inferFileType, type FileTypeInfo } from "./shared/inferFileType";
import { FileTypeBadge } from "./shared/FileTypeBadge";

export interface FileNodeData {
  id: string;
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  modified?: Date;
  children?: FileNodeData[];
  mountSource?: MountSource;
}

type FileTreeRowProps = NodeRendererProps<FileNodeData>;

function formatRemoteHostLabel(mountSource: MountSource): string {
  if (mountSource.user && mountSource.host) {
    if (mountSource.port && mountSource.port !== 22) {
      return `${mountSource.user}@${mountSource.host}:${mountSource.port}`;
    }
    return `${mountSource.user}@${mountSource.host}`;
  }
  if (mountSource.host) return mountSource.host;
  return mountSource.label ?? "remote";
}

function buildRemoteMountUri(mountSource: MountSource): string | null {
  if (!mountSource.host || !mountSource.remotePath) return null;
  const encodedUser = mountSource.user
    ? `${encodeURIComponent(mountSource.user)}@`
    : "";
  const port =
    mountSource.port && mountSource.port !== 22 ? `:${mountSource.port}` : "";
  return `ssh://${encodedUser}${mountSource.host}${port}${mountSource.remotePath}`;
}

function iconForKind(info: FileTypeInfo, isOpen: boolean): React.ComponentType {
  switch (info.kind) {
    case "dir":
      return isOpen ? VscFolderOpened : VscFolder;
    case "nii":
    case "niiGz":
    case "fourDNii":
    case "gii":
    case "surfGii":
    case "funcGii":
    case "analyze":
    case "dicom":
    case "mgz":
    case "mgh":
      return VscFileBinary;
    case "json":
      return VscJson;
    case "tsv":
    case "csv":
      return VscTable;
    case "md":
      return VscMarkdown;
    case "txt":
      return VscFileCode;
    default:
      return VscFile;
  }
}

/**
 * Split a file name into three runs for middle truncation:
 *
 *   head      — the start of the name; shrinks first, ellipsis at its end.
 *   stem      — the last few stem characters (where siblings such as
 *               `_brain` / `_brain_mask` usually differ); shrinks only once
 *               the head is gone, with the ellipsis at its START.
 *   extension — e.g. `.nii.gz`; never truncated.
 *
 * `tail` is `stem + extension` (or null when the name is short enough to be
 * shown whole). No characters are dropped here; ellipses only appear when the
 * column is actually too narrow, and at most one run is visibly cut at a time.
 */
export function splitDisplayName(
  name: string,
  isDir: boolean,
): {
  head: string;
  tail: string | null;
  stem: string | null;
  extension: string | null;
} {
  const whole = { head: name, tail: null, stem: null, extension: null };
  if (isDir || name.length <= 16) return whole;

  const lowerName = name.toLowerCase();
  const knownCompoundExtensions = [".nii.gz", ".tar.gz", ".csv.gz", ".tsv.gz"];
  const compoundMatch = knownCompoundExtensions.find((ext) =>
    lowerName.endsWith(ext),
  );
  const extensionLength = (() => {
    if (compoundMatch) return compoundMatch.length;
    const lastDot = name.lastIndexOf(".");
    if (lastDot > 0 && name.length - lastDot <= 10)
      return name.length - lastDot;
    return 0;
  })();

  // Extension plus up to ten characters of the stem, always leaving at least
  // four leading characters in the head.
  const tailLength = Math.min(extensionLength + 10, name.length - 4);
  if (tailLength <= 0) return whole;
  const tail = name.slice(name.length - tailLength);
  const extension = extensionLength > 0 ? name.slice(name.length - extensionLength) : "";
  return {
    head: name.slice(0, name.length - tailLength),
    tail,
    stem: tail.slice(0, tail.length - extension.length) || null,
    extension: extension || null,
  };
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
}

function highlightText(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part,
  );
}

export const FileTreeRow: React.FC<FileTreeRowProps> = ({ node, style }) => {
  const { data } = node;
  const fileBrowserStore = useFileBrowserStore();
  const selectedPath = useFileBrowserStore((state) => state.selectedPath);
  const searchQuery = useFileBrowserStore((state) => state.searchQuery);
  const isFourD = useFileBrowserStore((state) =>
    state.fourDPaths ? state.fourDPaths.has(data.path) : false,
  );
  // True while this folder's children are being fetched (e.g. a slow remote
  // SFTP listing on expand) — drives the per-row spinner.
  const isLoadingChildren = useFileBrowserStore(
    (state) => state.loadingPaths?.has(data.path) ?? false,
  );
  // True while this file is queued or actively loading into a layer — drives
  // the inline spinner that replaces the file-type icon so a click gives
  // immediate feedback (especially for slow remote downloads).
  const isLoadingFile = useIsLoading(data.path);

  const isSelected = selectedPath === data.path;
  const isDirectory = data.type === "directory";
  const remoteMountSource =
    isDirectory && node.level === 0 && data.mountSource?.kind === "remote"
      ? (data.mountSource as MountSource)
      : null;
  const remoteHostLabel = remoteMountSource
    ? formatRemoteHostLabel(remoteMountSource)
    : null;
  const remoteRootPath = remoteMountSource?.remotePath ?? null;
  const remoteUri = remoteMountSource
    ? buildRemoteMountUri(remoteMountSource)
    : null;
  const remoteOriginTooltip =
    remoteUri || remoteMountSource?.label?.trim() || remoteHostLabel || null;
  const remoteRootTooltip = remoteRootPath
    ? `Remote root: ${remoteRootPath}`
    : null;
  const remoteMountRowTooltip =
    remoteMountSource &&
    [
      `Mounted remote folder`,
      `Name: ${data.name}`,
      remoteOriginTooltip ? `Origin: ${remoteOriginTooltip}` : null,
      remoteRootPath ? `Root: ${remoteRootPath}` : null,
      `Local cache: ${data.path}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");

  const typeInfo = inferFileType(data.path, isDirectory, { isFourD });
  const FileIcon = iconForKind(typeInfo, Boolean(node.isOpen));

  function handleDoubleClick() {
    if (!isDirectory) {
      getEventBus().emit("filebrowser.file.doubleclick", { path: data.path });
    }
  }

  function handleDragStart(event: React.DragEvent) {
    if (!event.dataTransfer) return;
    event.stopPropagation();

    const dragData: DragFileData = {
      path: data.path,
      name: data.name,
      type: data.type,
      extension: data.extension,
    };

    setActiveDragData(dragData);

    const json = JSON.stringify(dragData);
    event.dataTransfer.setData(FILE_DRAG_MIME, json);
    event.dataTransfer.setData("application/json", json);
    event.dataTransfer.setData("text/plain", data.path);
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    const eventBus = getEventBus();
    const contextMenu = useContextMenuStore.getState();

    if (isDirectory) {
      const dirPath = data.path;
      const clientX = event.clientX;
      const clientY = event.clientY;

      const dirItems: ContextMenuItem[] = [
        {
          id: 'open-folder-studio',
          label: 'Open in Set Studio…',
          onClick: () => void getSetStudioService().openFolderOntologyInStudio({ discoveryRoot: dirPath }),
        },
        {
          id: "open-folder-image-set",
          label: "Open as switchable layer…",
          onClick: () => void getImageSetService().openFolder(dirPath),
        },
        {
          id: "open-dir",
          label: "Expand",
          onClick: () => {
            if (!node.isOpen) {
              node.toggle();
              if (!data.children || data.children.length === 0) {
                fileBrowserStore.loadDirectory(dirPath);
              }
            }
          },
        },
      ];
      contextMenu.open(clientX, clientY, dirItems);
      // Folder actions are immediate, including on remote mounts. Add the BIDS
      // action only if this menu is still open when discovery completes.
      void getTransport().invoke<boolean>("check_bids_directory", { path: dirPath })
        .then((isBids) => {
          const current = useContextMenuStore.getState();
          if (!isBids || !current.isOpen || current.items !== dirItems) return;
          contextMenu.open(clientX, clientY, [...dirItems, {
            id: "open-bids",
            label: "Open as BIDS dataset",
            onClick: () => {
              void useWorkspaceStore.getState().createWorkspace("bids-explorer");
              void useBidsStore.getState().scanDataset(dirPath);
            },
          }]);
        }).catch(() => { /* The ordinary folder actions remain available. */ });
      return;
    }

    const items: ContextMenuItem[] = [
      {
        id: "open-default",
        label: "Open",
        onClick: () => {
          eventBus.emit("filebrowser.file.open", {
            path: data.path,
            intent: "default" as DisplayOpenIntent,
          });
        },
      },
      {
        id: "add-layer",
        label: "Add as layer",
        onClick: () => {
          eventBus.emit("filebrowser.file.open", {
            path: data.path,
            intent: "add-layer" as DisplayOpenIntent,
          });
        },
      },
      { id: "sep-1", label: "", separator: true },
      {
        id: "new-workspace",
        label: "Open in new tab",
        onClick: () => {
          eventBus.emit("filebrowser.file.open", {
            path: data.path,
            intent: "new-workspace" as DisplayOpenIntent,
          });
        },
      },
      {
        id: "comparison",
        label: "Open in comparison view",
        onClick: () => {
          eventBus.emit("filebrowser.file.open", {
            path: data.path,
            intent: "comparison" as DisplayOpenIntent,
          });
        },
      },
    ];

    contextMenu.open(event.clientX, event.clientY, items);
  }

  const displayName = splitDisplayName(data.name, isDirectory);
  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div
      style={{ ...style, paddingLeft: `${style.paddingLeft || 0}px` }}
      className={`file-tree-item ${isSelected ? "selected" : ""} ${isDirectory ? "font-medium" : ""}`}
      title={remoteMountRowTooltip || data.name}
      draggable={!isDirectory}
      onDragStart={!isDirectory ? handleDragStart : undefined}
      onDragEnd={!isDirectory ? () => clearActiveDragData() : undefined}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={
        isDirectory && !node.isOpen
          ? () => useFileBrowserStore.getState().prefetchDirectory(data.path)
          : undefined
      }
    >
      {isDirectory ? (
        <button
          type="button"
          className="expand-button"
          aria-label={`${node.isOpen ? "Collapse" : "Expand"} ${data.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const wasOpen = node.isOpen;
            node.toggle();
            if (!wasOpen && (!data.children || data.children.length === 0)) {
              fileBrowserStore.loadDirectory(data.path);
            }
          }}
        >
          {isLoadingChildren ? (
            <VscLoading
              className="file-tree-spinner animate-spin"
              aria-label="Loading…"
            />
          ) : node.isOpen ? (
            <VscChevronDown />
          ) : (
            <VscChevronRight />
          )}
        </button>
      ) : (
        <div className="expand-spacer" />
      )}

      <span className="file-icon" style={{ color: typeInfo.iconColor }}>
        {!isDirectory && isLoadingFile ? (
          <VscLoading
            className="file-tree-spinner animate-spin"
            aria-label="Loading…"
          />
        ) : (
          <FileIcon />
        )}
      </span>

      {!isDirectory && <FileTypeBadge info={typeInfo} />}

      <div className="file-name" title={remoteMountRowTooltip || data.name}>
        <span className="file-name-text">
          {isSearchActive ? (
            <span className="file-name-head">
              {highlightText(data.name, searchQuery)}
            </span>
          ) : (
            <>
              <span className="file-name-head">{displayName.head}</span>
              {displayName.stem && (
                <span
                  className="file-name-stem"
                  style={{
                    minWidth: `${Math.min(3, displayName.stem.length)}ch`,
                  }}
                >
                  {/* RTL box puts the ellipsis at the start; the isolated LTR
                      run keeps neutral characters (_ - .) in reading order. */}
                  <bdi dir="ltr">{displayName.stem}</bdi>
                </span>
              )}
              {displayName.extension && (
                <span className="file-name-ext">{displayName.extension}</span>
              )}
            </>
          )}
        </span>
        {remoteHostLabel && (
          <span
            className="remote-origin-badge"
            title={remoteOriginTooltip || remoteHostLabel}
          >
            {remoteHostLabel}
          </span>
        )}
        {remoteRootPath && (
          <span
            className="remote-root-badge"
            title={remoteRootTooltip || remoteRootPath}
          >
            {remoteRootPath}
          </span>
        )}
      </div>

      <div className="file-meta">
        {data.type === "file" && data.size && (
          <span className="file-size">{formatFileSize(data.size)}</span>
        )}
      </div>
    </div>
  );
};
