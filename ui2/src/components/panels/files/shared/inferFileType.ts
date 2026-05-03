/**
 * File type inference for the Files panel.
 *
 * Pure (no React, no DOM) — used by FileTreeRow, FileTypeBadge,
 * RecentLocationsList, and any future Files surface that needs to
 * decide what kind of neuroimaging artifact a path represents.
 */

export type FileKind =
  | 'dir'
  | 'nii'
  | 'niiGz'
  | 'fourDNii'
  | 'gii'
  | 'surfGii'
  | 'funcGii'
  | 'analyze'
  | 'dicom'
  | 'mgz'
  | 'mgh'
  | 'tsv'
  | 'csv'
  | 'json'
  | 'md'
  | 'txt'
  | 'other';

export interface FileTypeInfo {
  /** Discriminant for downstream consumers. */
  kind: FileKind;
  /** Short uppercase token shown next to the filename. `null` = no badge. */
  badge: string | null;
  /** CSS color (token or hex) used by the icon glyph. */
  iconColor: string;
  /** Human-readable description for tooltips. */
  description: string;
}

interface InferOptions {
  /** Set true if the caller knows this NIfTI is 4D (e.g. opened previously). */
  isFourD?: boolean;
}

const DIR_INFO: FileTypeInfo = {
  kind: 'dir',
  badge: null,
  iconColor: 'var(--app-text-secondary)',
  description: 'Folder',
};

export function inferFileType(
  path: string,
  isDirectory: boolean,
  options: InferOptions = {}
): FileTypeInfo {
  if (isDirectory) return DIR_INFO;

  const name = path.toLowerCase();

  if (name.endsWith('.surf.gii')) {
    return {
      kind: 'surfGii',
      badge: 'SURF',
      iconColor: '#10b981',
      description: 'GIfTI surface mesh',
    };
  }
  if (name.endsWith('.func.gii')) {
    return {
      kind: 'funcGii',
      badge: 'FUNC',
      iconColor: '#10b981',
      description: 'GIfTI functional data',
    };
  }
  if (name.endsWith('.nii.gz')) {
    return options.isFourD
      ? {
          kind: 'fourDNii',
          badge: '4D',
          iconColor: 'var(--blue-500)',
          description: 'NIfTI 4D volume (gzip)',
        }
      : {
          kind: 'niiGz',
          badge: 'NII',
          iconColor: 'var(--blue-500)',
          description: 'NIfTI volume (gzip)',
        };
  }
  if (name.endsWith('.nii')) {
    return options.isFourD
      ? {
          kind: 'fourDNii',
          badge: '4D',
          iconColor: 'var(--blue-500)',
          description: 'NIfTI 4D volume',
        }
      : {
          kind: 'nii',
          badge: 'NII',
          iconColor: 'var(--blue-500)',
          description: 'NIfTI volume',
        };
  }
  if (name.endsWith('.gii')) {
    return {
      kind: 'gii',
      badge: 'GII',
      iconColor: '#10b981',
      description: 'GIfTI file',
    };
  }
  if (name.endsWith('.dcm') || name.endsWith('.dicom')) {
    return {
      kind: 'dicom',
      badge: 'DCM',
      iconColor: 'var(--app-error)',
      description: 'DICOM image',
    };
  }
  if (name.endsWith('.mgz')) {
    return {
      kind: 'mgz',
      badge: 'MGZ',
      iconColor: '#8b5cf6',
      description: 'FreeSurfer MGZ volume',
    };
  }
  if (name.endsWith('.mgh')) {
    return {
      kind: 'mgh',
      badge: 'MGH',
      iconColor: '#8b5cf6',
      description: 'FreeSurfer MGH volume',
    };
  }
  if (name.endsWith('.img') || name.endsWith('.hdr')) {
    return {
      kind: 'analyze',
      badge: 'ANA',
      iconColor: 'var(--app-warning)',
      description: 'Analyze 7.5',
    };
  }
  if (name.endsWith('.tsv')) {
    return {
      kind: 'tsv',
      badge: 'TSV',
      iconColor: 'var(--app-text-secondary)',
      description: 'Tab-separated values',
    };
  }
  if (name.endsWith('.csv')) {
    return {
      kind: 'csv',
      badge: 'CSV',
      iconColor: 'var(--app-text-secondary)',
      description: 'Comma-separated values',
    };
  }
  if (name.endsWith('.json')) {
    return {
      kind: 'json',
      badge: 'JSON',
      iconColor: 'var(--app-text-secondary)',
      description: 'JSON',
    };
  }
  if (name.endsWith('.md')) {
    return {
      kind: 'md',
      badge: null,
      iconColor: 'var(--app-text-secondary)',
      description: 'Markdown',
    };
  }
  if (name.endsWith('.txt')) {
    return {
      kind: 'txt',
      badge: null,
      iconColor: 'var(--app-text-secondary)',
      description: 'Plain text',
    };
  }
  return {
    kind: 'other',
    badge: null,
    iconColor: 'var(--app-text-secondary)',
    description: 'File',
  };
}
