import React from 'react';
import { cn } from '@/utils/cn';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  className = '',
  onClick,
  onMouseEnter,
  onMouseLeave,
  type = 'button',
  title
}) => {
  // Workstation restyle (docs/plans/workstation-shell-restyle.md): 24/28px
  // controls, 2px radius, primary follows the --primary token, token-only colours.
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary:
      'bg-bf-bg-panel-raised border border-border text-foreground hover:bg-accent',
    danger:
      'bg-bf-danger-soft border border-destructive/40 text-bf-danger hover:bg-destructive/25',
    ghost: 'text-bf-text-secondary hover:text-foreground hover:bg-accent',
    // HYBRID rule 5: links are light neutral with a visible underline, never
    // amber. No fill, no fixed height: the link sits on the text baseline.
    link: 'text-foreground underline underline-offset-2 decoration-[var(--bf-border-strong)] hover:decoration-current',
  };

  const sizeClasses = {
    sm: 'h-6 px-2 text-bf-xs',
    md: 'h-7 px-2.5 text-bf-sm',
    lg: 'h-7 px-4 text-bf-md',
  };

  const linkSizeClasses = {
    sm: 'h-auto px-0 text-bf-xs',
    md: 'h-auto px-0 text-bf-sm',
    lg: 'h-auto px-0 text-bf-md',
  };

  // cn (tailwind-merge) lets a caller's className override base classes of the
  // same group (e.g. `disabled:opacity-100` beats the base `disabled:opacity-50`).
  // A plain join left both in place, and Tailwind emits `disabled:opacity-50`
  // after `disabled:opacity-100`, so the override silently lost.
  const classes = cn(
    baseClasses,
    variantClasses[variant],
    variant === 'link' ? linkSizeClasses[size] : sizeClasses[size],
    className
  );

  const renderContent = () => {
    if (loading) {
      return (
        <>
          <svg 
            className="animate-spin -ml-0.5 mr-1.5 h-3.5 w-3.5" 
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
          Loading...
        </>
      );
    }

    return (
      <>
        {icon && iconPosition === 'left' && (
          <span className="mr-1.5">{icon}</span>
        )}
        {children}
        {icon && iconPosition === 'right' && (
          <span className="ml-1.5">{icon}</span>
        )}
      </>
    );
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
    >
      {renderContent()}
    </button>
  );
};