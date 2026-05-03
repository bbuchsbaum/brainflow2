import React from 'react';
import { VscHistory, VscPin, VscClose } from 'react-icons/vsc';
import { useFileBrowserStore, type RecentLocation } from '@/stores/fileBrowserStore';

interface RecentLocationsListProps {
  onMountLocal: () => void;
  onMountRemote: (recent: RecentLocation) => void;
}

function formatRelativeTime(epoch: number): string {
  const diff = Date.now() - epoch;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export const RecentLocationsList: React.FC<RecentLocationsListProps> = ({
  onMountLocal,
  onMountRemote,
}) => {
  const recents = useFileBrowserStore((state) => state.recents);
  const pinLocation = useFileBrowserStore((state) => state.pinLocation);
  const isPinned = useFileBrowserStore((state) => state.isPinned);
  const clearRecents = useFileBrowserStore((state) => state.clearRecents);

  if (recents.length === 0) {
    return (
      <section className="files-start-section" aria-label="Recent locations">
        <header className="files-start-section-header">
          <span className="files-start-section-title">Recents</span>
        </header>
        <p className="files-start-empty">
          Folders and files you mount or open will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="files-start-section" aria-label="Recent locations">
      <header className="files-start-section-header">
        <span className="files-start-section-title">Recents</span>
        <button
          type="button"
          className="files-start-section-link"
          onClick={clearRecents}
          title="Clear recent locations"
        >
          Clear
        </button>
      </header>
      <ul className="files-start-list">
        {recents.map((recent) => {
          const pinned = isPinned(recent.path);
          const isRemote = recent.mountSource.kind === 'remote';
          return (
            <li key={recent.path} className="files-start-row">
              <button
                type="button"
                className="files-start-row-main"
                onClick={() =>
                  isRemote ? onMountRemote(recent) : onMountLocal()
                }
                title={recent.path}
              >
                <VscHistory className="files-start-row-icon" aria-hidden="true" />
                <span className="files-start-row-label">{recent.displayName}</span>
                <span className="files-start-row-meta">
                  {isRemote ? 'Remote · ' : ''}
                  {formatRelativeTime(recent.lastOpened)}
                </span>
              </button>
              <button
                type="button"
                className="files-start-row-action"
                aria-label={pinned ? 'Already pinned' : 'Pin location'}
                title={pinned ? 'Already pinned' : 'Pin location'}
                disabled={pinned}
                onClick={() =>
                  pinLocation({
                    id: recent.path,
                    label: recent.displayName,
                    path: recent.path,
                    mountSource: recent.mountSource,
                  })
                }
              >
                <VscPin />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const PinnedLocationsList: React.FC<{ onActivate: (item: { path: string; mountSource: RecentLocation['mountSource'] }) => void }>
  = ({ onActivate }) => {
  const pinned = useFileBrowserStore((state) => state.pinned);
  const unpinLocation = useFileBrowserStore((state) => state.unpinLocation);

  if (pinned.length === 0) return null;

  return (
    <section className="files-start-section" aria-label="Pinned locations">
      <header className="files-start-section-header">
        <span className="files-start-section-title">Pinned</span>
      </header>
      <ul className="files-start-list">
        {pinned.map((item) => (
          <li key={item.id} className="files-start-row">
            <button
              type="button"
              className="files-start-row-main"
              onClick={() => onActivate({ path: item.path, mountSource: item.mountSource })}
              title={item.path}
            >
              <VscPin className="files-start-row-icon" aria-hidden="true" />
              <span className="files-start-row-label">{item.label}</span>
              <span className="files-start-row-meta">
                {item.mountSource.kind === 'remote' ? 'Remote' : 'Local'}
              </span>
            </button>
            <button
              type="button"
              className="files-start-row-action"
              aria-label={`Unpin ${item.label}`}
              title="Unpin"
              onClick={() => unpinLocation(item.id)}
            >
              <VscClose />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
