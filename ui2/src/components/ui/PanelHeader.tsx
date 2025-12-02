import React from 'react';

interface PanelHeaderAction {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface PanelHeaderProps {
  title: string;
  icon?: string;
  actions?: PanelHeaderAction[];
  className?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({ 
  title, 
  icon, 
  actions = [],
  className = ""
}) => {
  const defaultClasses = "flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border text-sm font-medium text-foreground/80 select-none rounded-t-md";
  const finalClasses = className || defaultClasses;

  return (
    <div className={finalClasses}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className="text-gray-500">{icon}</span>
        )}
        <span>{title}</span>
      </div>
      
      {actions.length > 0 && (
        <div className="flex items-center gap-1">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={action.disabled}
              onClick={action.onClick}
              title={action.label}
            >
              {action.icon ? (
                <span className="text-xs">{action.icon}</span>
              ) : (
                <span className="text-xs">{action.label}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
