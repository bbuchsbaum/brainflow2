/**
 * SliceView Component Tests
 * Tests core slice rendering and interaction functionality
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SliceView } from '../SliceView';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getApiService } from '@/services/apiService';
import { createMockViewState } from '../../../test-setup';

// Mock the store
vi.mock('@/stores/viewStateStore');
vi.mock('@/services/apiService');

const mockSetCrosshair = vi.fn();
const mockApiService = {
  applyAndRenderViewState: vi.fn(),
};

describe('SliceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup store mock
    (useViewStateStore as any).mockReturnValue({
      viewState: createMockViewState(),
      setCrosshair: mockSetCrosshair,
    });
    
    // Setup API service mock
    (getApiService as any).mockReturnValue(mockApiService);
    
    // Mock successful render
    mockApiService.applyAndRenderViewState.mockResolvedValue({
      width: 256,
      height: 256,
      close: vi.fn(),
    });
  });

  it('should render canvas with correct dimensions', () => {
    render(<SliceView viewId="axial" width={512} height={512} />);
    
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
  });

  it('should display view label', () => {
    render(<SliceView viewId="sagittal" width={256} height={256} />);
    
    expect(screen.getByText('Sagittal')).toBeInTheDocument();
  });

  it('should handle mouse clicks and update crosshair', async () => {
    render(<SliceView viewId="axial" width={256} height={256} />);
    
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    
    // Mock getBoundingClientRect
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 256,
      height: 256,
      right: 256,
      bottom: 256,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }));
    
    // Click center of canvas
    fireEvent.click(canvas, {
      clientX: 128,
      clientY: 128,
    });
    
    // Should call setCrosshair with transformed coordinates
    expect(mockSetCrosshair).toHaveBeenCalledWith(
      expect.any(Array),
      true
    );
  });

  it('should show hover coordinates on mouse move', () => {
    render(<SliceView viewId="coronal" width={256} height={256} />);
    
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 256,
      height: 256,
      right: 256,
      bottom: 256,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }));
    
    fireEvent.mouseMove(canvas, {
      clientX: 100,
      clientY: 100,
    });
    
    // Should show coordinate display
    expect(screen.getByText(/\(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\)/)).toBeInTheDocument();
  });

  it('should hide coordinates on mouse leave', () => {
    render(<SliceView viewId="axial" width={256} height={256} />);
    
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 256,
      height: 256,
      right: 256,
      bottom: 256,
      x: 0,
      y: 0,
      toJSON: vi.fn(),
    }));
    
    // Show coordinates
    fireEvent.mouseMove(canvas, {
      clientX: 100,
      clientY: 100,
    });
    
    expect(screen.getByText(/\(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\)/)).toBeInTheDocument();
    
    // Hide coordinates
    fireEvent.mouseLeave(canvas);
    
    expect(screen.queryByText(/\(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\)/)).not.toBeInTheDocument();
  });

  it('should show loading state during render', async () => {
    // Make API call take some time
    mockApiService.applyAndRenderViewState.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 100))
    );
    
    render(<SliceView viewId="axial" width={256} height={256} />);
    
    await waitFor(() => {
      expect(screen.getByText('Rendering...')).toBeInTheDocument();
    });
  });

  it('should show error state on render failure', async () => {
    mockApiService.applyAndRenderViewState.mockRejectedValue(
      new Error('Render failed')
    );
    
    render(<SliceView viewId="axial" width={256} height={256} />);
    
    await waitFor(() => {
      expect(screen.getByText(/Error: Render failed/)).toBeInTheDocument();
    });
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SliceView viewId="axial" width={256} height={256} className="custom-class" />
    );
    
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should request render on mount', async () => {
    render(<SliceView viewId="axial" width={256} height={256} />);
    
    await waitFor(() => {
      expect(mockApiService.applyAndRenderViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          views: expect.objectContaining({
            axial: expect.any(Object),
          }),
        })
      );
    });
  });

  it('should handle different view IDs correctly', () => {
    const views = ['axial', 'sagittal', 'coronal'] as const;
    
    views.forEach(viewId => {
      const { unmount } = render(<SliceView viewId={viewId} width={256} height={256} />);
      
      expect(screen.getByText(
        viewId.charAt(0).toUpperCase() + viewId.slice(1)
      )).toBeInTheDocument();
      
      unmount();
    });
  });
});