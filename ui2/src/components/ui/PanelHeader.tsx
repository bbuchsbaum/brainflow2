import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu } from './DropdownMenu';
import { Button } from './Button';
import { IconButton } from './IconButton';

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
    <div className={`flex items-center ${hideTitle ? 'justify-end' : 'justify-between'} border-b border-border bg-muted/10 px-3 py-1.5 ${className}`}>
      {!hideTitle && (
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h3 className="bf-role-section text-foreground truncate">{title}</h3>
        </div>
      )}

      <div className="flex items-center gap-1.5 shrink-0">
        {primaryAction && (
          <Button
            variant="secondary"
            size="sm"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            title={primaryAction.title ?? primaryAction.label}
            icon={primaryAction.icon}
          >
            {primaryAction.label}
          </Button>
        )}

        {hasOverflow && (
          <DropdownMenu
            position="bottom-right"
            trigger={
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={`${actionLabelBase} actions`}
                icon={<MoreHorizontal />}
              />
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
