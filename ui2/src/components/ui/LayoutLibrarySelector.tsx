import React, { useMemo } from 'react';
import { ChevronDown, FolderOpen, Pencil, Save, Trash2 } from 'lucide-react';
import { DropdownMenu } from './DropdownMenu';
import { useLayoutLibraryStore } from '@/stores/layoutLibraryStore';
import { cn } from '@/utils/cn';

interface LayoutLibrarySelectorProps {
  className?: string;
}

export function LayoutLibrarySelector({ className }: LayoutLibrarySelectorProps) {
  const layouts = useLayoutLibraryStore((state) => state.layouts);
  const activeLayoutId = useLayoutLibraryStore((state) => state.activeLayoutId);
  const saveCurrentLayout = useLayoutLibraryStore((state) => state.saveCurrentLayout);
  const loadLayout = useLayoutLibraryStore((state) => state.loadLayout);
  const renameLayout = useLayoutLibraryStore((state) => state.renameLayout);
  const deleteLayout = useLayoutLibraryStore((state) => state.deleteLayout);
  const clearError = useLayoutLibraryStore((state) => state.clearError);

  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.id === activeLayoutId) ?? null,
    [activeLayoutId, layouts]
  );

  const showLastError = () => {
    const error = useLayoutLibraryStore.getState().lastError;
    if (error) {
      window.alert(error);
      clearError();
    }
  };

  const promptSaveLayout = () => {
    const suggestedName = `Layout ${new Date().toLocaleString()}`;
    const name = window.prompt('Save current layout as:', suggestedName);
    if (!name) {
      return;
    }

    const ok = saveCurrentLayout(name);
    if (!ok) {
      showLastError();
    }
  };

  const promptRenameLayout = (layoutId: string, currentName: string) => {
    const nextName = window.prompt(`Rename layout '${currentName}' to:`, currentName);
    if (!nextName || nextName === currentName) {
      return;
    }

    const ok = renameLayout(layoutId, nextName);
    if (!ok) {
      showLastError();
    }
  };

  const promptDeleteLayout = (layoutId: string, name: string) => {
    const confirmed = window.confirm(`Delete saved layout '${name}'?`);
    if (!confirmed) {
      return;
    }

    const ok = deleteLayout(layoutId);
    if (!ok) {
      showLastError();
    }
  };

  const items = [
    {
      id: 'layout.save',
      label: 'Save Current Layout…',
      icon: <Save className="h-3.5 w-3.5" />,
      onClick: promptSaveLayout,
    },
    {
      id: 'layout.sep.load',
      separator: true,
    },
    ...(
      layouts.length > 0
        ? layouts.map((layout) => ({
            id: `layout.load.${layout.id}`,
            label: `${layout.id === activeLayoutId ? '● ' : ''}${layout.name}`,
            icon: <FolderOpen className="h-3.5 w-3.5" />,
            onClick: () => {
              const ok = loadLayout(layout.id);
              if (!ok) {
                showLastError();
              }
            },
          }))
        : [
            {
              id: 'layout.none',
              label: 'No saved layouts',
              disabled: true,
            },
          ]
    ),
    {
      id: 'layout.sep.manage',
      separator: true,
    },
    ...layouts.map((layout) => ({
      id: `layout.rename.${layout.id}`,
      label: `Rename: ${layout.name}`,
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => promptRenameLayout(layout.id, layout.name),
    })),
    ...layouts.map((layout) => ({
      id: `layout.delete.${layout.id}`,
      label: `Delete: ${layout.name}`,
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onClick: () => promptDeleteLayout(layout.id, layout.name),
    })),
  ];

  return (
    <DropdownMenu
      position="top-right"
      trigger={
        <button
          type="button"
          className={cn('status-toggle status-toggle--layout', className)}
          aria-label="Manage saved layouts"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span>{activeLayout ? activeLayout.name : 'Layouts'}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      }
      items={items}
    />
  );
}
