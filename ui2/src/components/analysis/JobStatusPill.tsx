/**
 * The job-state pill now lives in the shared primitives (`ui/bf/StatusPill`);
 * this module re-exports it so existing imports keep working.
 */
export { JobStatusPill } from '@/components/ui/bf/StatusPill';
export { jobStateLabel } from '@/components/ui/bf/helpers';
