/**
 * Direction H, round 5: the workflow states beyond tracing (AI assist and
 * its licence gate, white-matter lesions on FLAIR, contrast aids, history,
 * save, resume and session setup), on H's shell. DESIGN.md has a section
 * per state.
 */

import React from 'react';
import type { WorkflowState } from '@/modules/segmentation/components/shared/types';
import { AiConsentState, AiPromptState } from './AiStates';
import { ContrastAidsState } from './ContrastAids';
import { HistoryState } from './HistoryState';
import { LesionState } from './LesionState';
import { ResumeState, SaveState, SetupState } from './SessionStates';

export function DirectionHWorkflow({ state }: { state: WorkflowState }) {
  switch (state) {
    case 'ai-prompt':
      return <AiPromptState />;
    case 'ai-consent':
      return <AiConsentState />;
    case 'lesion':
      return <LesionState />;
    case 'contrast-aids':
      return <ContrastAidsState />;
    case 'history':
      return <HistoryState />;
    case 'save':
      return <SaveState />;
    case 'resume':
      return <ResumeState />;
    case 'setup':
      return <SetupState />;
  }
}
