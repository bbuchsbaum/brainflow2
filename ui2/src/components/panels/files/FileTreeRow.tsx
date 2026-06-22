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

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}

function formatDisplayName(
  name: string,
  isDir: boolean,
  searchQuery: string,
): { head: string; tail: string | null } {
  if (searchQuery.trim().length > 0) return { head: name, tail: null };
  if (isDir) return { head: truncateMiddle(name, 34), tail: null };

  // Threshold tuned for the 320 px left rail (Design.md §2.2). Above this,
  // we split the name into a head (truncated) + tail (the meaningful
  // extension like `.nii.gz`) so the file type stays visible even when the
  // column is narrow. Below it the full name fits and CSS ellipsis suffices.
  const maxLength = 28;
  if (name.length <= maxLength) return { head: name, tail: null };

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

  const desiredTailLength = extensionLength > 0 ? extensionLength + 8 : 14;
  const tailLength = Math.min(
    Math.max(desiredTailLength, 12),
    20,
    name.length - 8,
  );
  const headLength = Math.max(8, maxLength - tailLength - 1);

  return {
    head: `${name.slice(0, headLength)}…`,
    tail: name.slice(name.length - tailLength),
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

function highlightText(text: string, query: string): string {
  if (!query) return text;
  const escaped = query.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>');
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

      void (async () => {
        let isBids = false;
        try {
          isBids = await getTransport().invoke<boolean>(
            "check_bids_directory",
            { path: dirPath },
          );
        } catch {
          // Non-fatal: show menu without BIDS option if check fails
        }

        const dirItems: ContextMenuItem[] = [
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

        if (isBids) {
          dirItems.push({
            id: "open-bids",
            label: "Open as BIDS Dataset",
            onClick: () => {
              void useWorkspaceStore
                .getState()
                .createWorkspace("bids-explorer");
              void useBidsStore.getState().scanDataset(dirPath);
            },
          });
        }

        contextMenu.open(clientX, clientY, dirItems);
      })();
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
        label: "Add As Layer",
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
        label: "Open In New Tab",
        onClick: () => {
          eventBus.emit("filebrowser.file.open", {
            path: data.path,
            intent: "new-workspace" as DisplayOpenIntent,
          });
        },
      },
      {
        id: "comparison",
        label: "Open In Comparison View",
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

  const displayName = formatDisplayName(data.name, isDirectory, searchQuery);
  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div
      style={{ ...style, paddingLeft: `${style.paddingLeft || 0}px` }}
      className={`file-tree-item ${isSelected ? "selected" : ""} ${isDirectory ? "font-medium" : ""}`}
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

      <div className="file-name" title={remoteMountRowTooltip || undefined}>
        {isSearchActive ? (
          <span
            className="file-name-text"
            title={remoteMountRowTooltip || data.name}
            dangerouslySetInnerHTML={{
              __html: highlightText(displayName.head, searchQuery),
            }}
          />
        ) : (
          <span
            className="file-name-text"
            title={remoteMountRowTooltip || data.name}
          >
            <span className="file-name-head">{displayName.head}</span>
            {displayName.tail && (
              <span className="file-name-tail">{displayName.tail}</span>
            )}
          </span>
        )}
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
