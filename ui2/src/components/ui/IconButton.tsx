import React from 'react';
import { cn } from '@/utils/cn';

interface IconButtonProps {
  icon: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label': string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  onClick,
  onMouseEnter,
  onMouseLeave,
  type = 'button',
  title,
  'aria-label': ariaLabel
}) => {
  const baseClasses = 'inline-flex items-center justify-center font-medium rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variantClasses = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-bf-bg-panel-raised border border-border text-foreground hover:bg-accent',
    danger: 'bg-bf-danger-soft border border-destructive/40 text-bf-danger hover:bg-destructive/25',
    ghost: 'text-bf-text-secondary hover:text-foreground hover:bg-accent'
  };
  
  const sizeClasses = {
    sm: 'p-1.5',
    md: 'p-2',
    lg: 'p-3'
  };
  
  const iconSizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5', 
    lg: 'w-6 h-6'
  };
  
  const classes = cn(
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    className
  );

  const iconElement = React.isValidElement(icon) 
    ? React.cloneElement(icon as React.ReactElement<any>, {
        className: iconSizeClasses[size]
      })
    : icon;

  const renderContent = () => {
    if (loading) {
      return (
        <svg 
          className={`animate-spin ${iconSizeClasses[size]}`}
          fill="none" 
          viewBox="0 0 24 24"
        >
          <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          />
          <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      );
    }

    return iconElement;
  };

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={title}
      aria-label={ariaLabel}
    >
      {renderContent()}
    </button>
  );
};
