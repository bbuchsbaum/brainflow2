/**
 * OrthogonalPanelsWorkspace — arrangement layout (CSS grid) + menu gating.
 *
 * FlexibleSlicePanel and the arrangement menu are stubbed. All arrangements use
 * a flat three-child CSS grid (no Allotment): grid is a 2×2 with axial spanning
 * the top row, row is grid-cols-3, column is grid-rows-3.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../FlexibleSlicePanel", () => ({
  FlexibleSlicePanel: ({ viewId }: { viewId: string }) => (
    <div data-testid={`slice-${viewId}`}>{viewId}</div>
  ),
}));

vi.mock("@/components/ui/ArrangementMenu", () => ({
  ArrangementMenu: () => <div data-testid="arrangement-menu-stub" />,
}));

import { OrthogonalPanelsWorkspace } from "../OrthogonalPanelsWorkspace";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

function expectAllThreeSlices() {
  expect(screen.getByTestId("slice-axial")).toBeInTheDocument();
  expect(screen.getByTestId("slice-sagittal")).toBeInTheDocument();
  expect(screen.getByTestId("slice-coronal")).toBeInTheDocument();
}

describe("OrthogonalPanelsWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it("renders a 2x2 grid (axial spans the top row) by default, with the corner menu", () => {
    const { container } = render(<OrthogonalPanelsWorkspace />);
    expectAllThreeSlices();
    expect(screen.getByTestId("arrangement-menu-stub")).toBeInTheDocument();

    const grid = container.querySelector(".grid-cols-2.grid-rows-2");
    expect(grid).not.toBeNull();
    // Axial spans both columns (top row, full width).
    expect(container.querySelector(".col-span-2")).not.toBeNull();
    // No Allotment splitter is used anywhere.
    expect(container.querySelector(".split-view")).toBeNull();
  });

  it("lays out a horizontal row (grid-cols-3) when arrangement=row", () => {
    useLayoutSettingsStore.getState().setOrthoArrangement("row");
    const { container } = render(<OrthogonalPanelsWorkspace />);
    expect(container.querySelector(".grid-cols-3")).not.toBeNull();
    expect(container.querySelector(".col-span-2")).toBeNull();
    expectAllThreeSlices();
  });

  it("lays out a vertical column (grid-rows-3) when arrangement=column", () => {
    useLayoutSettingsStore.getState().setOrthoArrangement("column");
    const { container } = render(<OrthogonalPanelsWorkspace />);
    expect(container.querySelector(".grid-rows-3")).not.toBeNull();
    expect(container.querySelector(".col-span-2")).toBeNull();
    expectAllThreeSlices();
  });

  it("suppresses its own menu when showArrangementMenu is false", () => {
    render(<OrthogonalPanelsWorkspace showArrangementMenu={false} />);
    expect(screen.queryByTestId("arrangement-menu-stub")).toBeNull();
    expect(screen.getByTestId("slice-axial")).toBeInTheDocument();
  });
});
