import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu } from './DropdownMenu';

export interface PanelHeaderPrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  title?: string;
}

export interface PanelHeaderOverflowAction {
  id: string;
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}

interface PanelHeaderProps {
  title: string;
  icon?: React.ReactNode;
  className?: string;
  primaryAction?: PanelHeaderPrimaryAction;
  overflowActions?: PanelHeaderOverflowAction[];
  hideTitle?: boolean;
  actionsAriaLabel?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  icon,
  className = '',
  primaryAction,
  overflowActions = [],
  hideTitle = false,
  actionsAriaLabel,
}) => {
  const hasOverflow = overflowActions.length > 0;
  const actionLabelBase = (actionsAriaLabel ?? title) || 'Panel';

  return (
    <div className={`flex items-center justify-between border-b border-border bg-muted/10 px-3 py-2 ${className}`}>
      {!hideTitle ? (
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h3 className="bf-role-section text-foreground truncate">{title}</h3>
        </div>
      ) : (
        <div aria-hidden="true" />
      )}

      <div className="flex items-center gap-1.5 shrink-0">
        {primaryAction && (
          <button
            type="button"
            className="bf-control-sm rounded-appsm border border-border bg-background px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            title={primaryAction.title ?? primaryAction.label}
          >
            <span className="inline-flex items-center gap-1">
              {primaryAction.icon}
              {primaryAction.label}
            </span>
          </button>
        )}

        {hasOverflow && (
          <DropdownMenu
            position="bottom-right"
            trigger={
              <button
                type="button"
                className="icon-btn rounded-appsm"
                aria-label={`${actionLabelBase} actions`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
            items={overflowActions.map((action) => ({
              id: action.id,
              label: action.label,
              icon: action.icon,
              danger: action.danger,
              disabled: action.disabled,
              onClick: action.onClick,
            }))}
          />
        )}
      </div>
    </div>
  );
};
