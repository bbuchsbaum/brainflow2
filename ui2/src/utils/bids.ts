/** Format bare subject ID for display: "01" → "sub-01" */
export const formatSubjectId = (id: string): string =>
  id.startsWith('sub-') ? id : `sub-${id}`;

/** Format bare session ID for display: "01" → "ses-01" */
export const formatSessionId = (id: string): string =>
  id.startsWith('ses-') ? id : `ses-${id}`;
