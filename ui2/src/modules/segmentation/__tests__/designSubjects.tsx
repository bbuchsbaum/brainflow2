/**
 * The screens the design contract tests render (`designContract.test.tsx`).
 *
 * Today they are the design components in `components/directions/h/` on the
 * mock data. When a screen is promoted to production, render the promoted
 * component here, fed by a fixture session that reproduces the mock's
 * numbers; the contract tests then run unchanged against it.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { DirectionH } from '@/modules/segmentation/components/directions/h/DirectionH';
import { DirectionHWorkflow } from '@/modules/segmentation/components/directions/h/workflow/WorkflowH';
import type { DesignState, WorkflowState } from '@/modules/segmentation/components/shared/types';

/** A core state (empty, tracing, multi-contrast, blocked, proposal, review, zoom). */
export const renderCore = (state: DesignState) => render(<DirectionH state={state} />);

/** A workflow state (AI, lesions, contrast aids, history, save, resume, setup). */
export const renderWorkflow = (state: WorkflowState) =>
  render(<DirectionHWorkflow state={state} />);
