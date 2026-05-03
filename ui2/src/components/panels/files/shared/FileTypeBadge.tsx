import React from 'react';
import type { FileTypeInfo } from './inferFileType';

interface FileTypeBadgeProps {
  info: FileTypeInfo;
  className?: string;
}

/**
 * Short uppercase token shown next to a filename so the user can
 * spot neuroimaging artifacts (NII / 4D / GII / DCM …) without
 * scanning the extension.
 */
export const FileTypeBadge: React.FC<FileTypeBadgeProps> = ({ info, className }) => {
  if (!info.badge) return null;
  return (
    <span
      className={`file-type-badge file-type-badge--${info.kind} ${className ?? ''}`.trim()}
      title={info.description}
      aria-label={info.description}
    >
      {info.badge}
    </span>
  );
};
