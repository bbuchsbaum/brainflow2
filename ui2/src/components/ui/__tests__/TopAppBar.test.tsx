/**
 * TopAppBar — mockup7 top app chrome
 * (mote `bd-01KQK37ZYCKC3V7GX2KBWJ3X3A`, AC#2).
 *
 * Verifies the top bar mounts with brand mark, display-mode selector,
 * and workspace utility actions in the layout positions specified by
 * Design.md §6.1 (brand left, display modes center, utility right).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TopAppBar } from "../TopAppBar";

vi.mock("@/components/ui/DisplayModeSelector", () => ({
  DisplayModeSelector: () => (
    <div data-testid="display-mode-selector-stub">display-mode</div>
  ),
}));
vi.mock("@/components/ui/WorkspaceMenu", () => ({
  WorkspaceMenu: () => (
    <div data-testid="workspace-menu-stub">workspace-menu</div>
  ),
}));

describe("TopAppBar", () => {
  it("renders the brand, display-mode selector, and workspace utility actions in three regions", () => {
    render(<TopAppBar />);

    const bar = screen.getByTestId("top-app-bar");
    expect(bar).toBeInTheDocument();

    // Brand region — Design.md §6.1 starts with "Brand".
    const brand = screen.getByTestId("top-app-bar-brand");
    expect(brand).toHaveTextContent(/BrainFlow/);

    // Center region houses the display mode pills.
    const center = screen.getByTestId("top-app-bar-center");
    expect(center).toContainElement(
      screen.getByTestId("display-mode-selector-stub"),
    );

    // Utility region collects the single merged Workspace menu.
    const utility = screen.getByTestId("top-app-bar-utility");
    expect(utility).toContainElement(screen.getByTestId("workspace-menu-stub"));
  });

  it("renders the bar at the 40px height defined in Design.md §2.2", () => {
    render(<TopAppBar />);

    const bar = screen.getByTestId("top-app-bar");
    expect(bar.style.height).toBe("40px");
    expect(bar.style.minHeight).toBe("40px");
  });

  it("does not paint over the GoldenLayout tab strip below it", () => {
    render(<TopAppBar />);

    const bar = screen.getByTestId("top-app-bar");
    expect(bar.style.position).toBe("");
    expect(bar.style.zIndex).toBe("");
    expect(bar.style.boxShadow).toBe("");
  });

  it("mounts caller-provided centerStart and utility slots without disturbing the canonical contents", () => {
    render(
      <TopAppBar
        centerStart={<div data-testid="custom-center-start">center-start</div>}
        utility={<div data-testid="custom-utility">custom-utility</div>}
      />,
    );

    const center = screen.getByTestId("top-app-bar-center");
    expect(center).toContainElement(screen.getByTestId("custom-center-start"));
    // The DisplayModeSelector still renders alongside the custom slot.
    expect(center).toContainElement(
      screen.getByTestId("display-mode-selector-stub"),
    );

    const utility = screen.getByTestId("top-app-bar-utility");
    expect(utility).toContainElement(screen.getByTestId("custom-utility"));
    // The Workspace menu still mounts in the utility region.
    expect(utility).toContainElement(screen.getByTestId("workspace-menu-stub"));
  });
});
