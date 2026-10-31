/**
 * The Segmentation module in the shell: registered, experimental and off by
 * default, with no bridge section; and every design direction renders every
 * design state (the dev-harness scenarios) without throwing.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BRIDGE_MODULES } from '@brainflow/api';
import { FIRST_PARTY_MODULES } from '@/modules/index';
import { moduleRegistry, stageDefaultEnabled } from '@/modules/registry';
import segmentation, { SEGMENTATION_WORKSPACE } from '@/modules/segmentation/module';
import { DIRECTIONS } from '@/modules/segmentation/components/directions';
import { SegmentationWorkspace } from '@/modules/segmentation/components/SegmentationWorkspace';
import { DESIGN_STATES, WORKFLOW_STATES } from '@/modules/segmentation/components/shared/types';

describe('segmentation module', () => {
  it('is registered as an experimental desktop module, off by default', () => {
    expect(FIRST_PARTY_MODULES).toContain(segmentation);
    expect(moduleRegistry.getModules().map((m) => m.id)).toContain('segmentation');
    expect(segmentation.stage).toBe('experimental');
    expect(segmentation.hosts).toEqual(['desktop']);
    expect(stageDefaultEnabled(segmentation.stage)).toBe(false);
    expect(Object.keys(BRIDGE_MODULES)).not.toContain('segmentation');
    expect(segmentation.contributes.keybindings ?? []).toEqual([]);
    expect(segmentation.contributes.workspaces?.map((w) => w.id)).toEqual([SEGMENTATION_WORKSPACE]);
  });

  it('its tool tab says editing is not available', () => {
    render(<SegmentationWorkspace workspaceId="w1" />);
    expect(screen.getByText('Segmentation is in design')).toBeTruthy();
  });

  describe.each(Object.values(DIRECTIONS))('direction $id ($title)', (direction) => {
    it.each(DESIGN_STATES)('renders %s', (state) => {
      const Component = direction.component;
      const { container, unmount } = render(<Component state={state} />);
      expect(container.querySelectorAll('svg image').length).toBeGreaterThan(0);
      expect(container.textContent).toContain('Design mock');
      unmount();
    });
  });

  // Round 5: direction H's workflow states (AI, lesions, contrast aids, history, save, resume, setup).
  describe.each(Object.values(DIRECTIONS).filter((d) => d.workflow))('direction $id workflow', (direction) => {
    it.each(WORKFLOW_STATES)('renders %s', (state) => {
      const Workflow = direction.workflow!;
      const { container, unmount } = render(<Workflow state={state} />);
      expect(container.querySelectorAll('svg image').length).toBeGreaterThan(0);
      expect(container.textContent).toContain('Design mock');
      unmount();
    });
  });
});
