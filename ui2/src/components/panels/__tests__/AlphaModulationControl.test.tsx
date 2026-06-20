/**
 * AlphaModulationControl - intensity-modulated overlay alpha ("transparent
 * thresholding"). Verifies the mode toggle, onChange wiring (preserving
 * gamma/center), the live curve sparkline visibility, and disabled state.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  AlphaModulationControl,
  computeAlphaModFactor,
} from "../AlphaModulationControl";
import type { AlphaModConfig } from "@/types/viewState";

const baseProps = {
  intensity: [-1, 1] as [number, number],
  threshold: [0.2, 1] as [number, number],
};

describe("AlphaModulationControl", () => {
  it("defaults to Off and hides the sparkline when value is undefined", () => {
    render(
      <AlphaModulationControl
        {...baseProps}
        value={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("alpha-mod-off")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("alpha-mod-linear")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByTestId("alpha-mod-sparkline")).toBeNull();
  });

  it("selecting Gamma emits a config preserving gamma/center and shows the curve + slider", () => {
    const onChange = vi.fn();
    const value: AlphaModConfig = { mode: "linear", gamma: 2.5, center: 0.1 };
    render(
      <AlphaModulationControl
        {...baseProps}
        value={value}
        onChange={onChange}
      />,
    );

    // linear value already shows the sparkline, not the gamma slider
    expect(screen.getByTestId("alpha-mod-sparkline")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("alpha-mod-gamma"));
    expect(onChange).toHaveBeenCalledWith({
      mode: "gamma",
      gamma: 2.5,
      center: 0.1,
    });
  });

  it("shows the gamma slider only in Gamma mode", () => {
    const { rerender } = render(
      <AlphaModulationControl
        {...baseProps}
        value={{ mode: "linear", gamma: 1, center: 0 }}
        onChange={vi.fn()}
      />,
    );
    // In linear mode only the toggle button reads "Gamma"; no slider label.
    expect(screen.getAllByText("Gamma")).toHaveLength(1);

    rerender(
      <AlphaModulationControl
        {...baseProps}
        value={{ mode: "gamma", gamma: 1, center: 0 }}
        onChange={vi.fn()}
      />,
    );
    // In gamma mode the toggle button AND the slider label both read "Gamma".
    expect(screen.getAllByText("Gamma")).toHaveLength(2);
  });

  it("disables every mode button when disabled", () => {
    render(
      <AlphaModulationControl
        {...baseProps}
        value={{ mode: "off", gamma: 1, center: 0 }}
        onChange={vi.fn()}
        disabled
        disabledReason="no effect under Max/Min"
      />,
    );
    expect(screen.getByTestId("alpha-mod-off")).toBeDisabled();
    expect(screen.getByTestId("alpha-mod-linear")).toBeDisabled();
    expect(screen.getByTestId("alpha-mod-gamma")).toBeDisabled();
  });

  it("ramps signed maps from the visible threshold boundary", () => {
    const intensity: [number, number] = [-1, 1];
    const threshold: [number, number] = [-0.2, 0.2];

    expect(
      computeAlphaModFactor(0.2, "linear", 1, intensity, threshold),
    ).toBe(0);
    expect(
      computeAlphaModFactor(0.6, "linear", 1, intensity, threshold),
    ).toBeCloseTo(0.5);
    expect(
      computeAlphaModFactor(-0.6, "linear", 1, intensity, threshold),
    ).toBeCloseTo(0.5);
  });

  it("marks both threshold boundaries on a signed sparkline", () => {
    render(
      <AlphaModulationControl
        intensity={[-1, 1]}
        threshold={[-0.2, 0.2]}
        value={{ mode: "linear", gamma: 1, center: 0 }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("alpha-mod-threshold-marker")).toHaveLength(
      2,
    );
  });
});
