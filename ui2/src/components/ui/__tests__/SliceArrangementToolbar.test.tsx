import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SliceArrangementToolbar } from "../SliceArrangementToolbar";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

describe("SliceArrangementToolbar", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it("reflects and updates the ortho arrangement", () => {
    render(<SliceArrangementToolbar />);

    // Default arrangement is grid.
    expect(screen.getByTestId("ortho-arrangement-grid")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("ortho-arrangement-row"));
    expect(useLayoutSettingsStore.getState().orthoArrangement).toBe("row");
    expect(screen.getByTestId("ortho-arrangement-row")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("ortho-arrangement-column"));
    expect(useLayoutSettingsStore.getState().orthoArrangement).toBe("column");
  });

  it("hides the split toggle unless showSplit is set", () => {
    const { rerender } = render(<SliceArrangementToolbar />);
    expect(screen.queryByTestId("integrated-split-horizontal")).toBeNull();

    rerender(<SliceArrangementToolbar showSplit />);
    expect(
      screen.getByTestId("integrated-split-horizontal"),
    ).toBeInTheDocument();
  });

  it("reflects and updates the integrated split when shown", () => {
    render(<SliceArrangementToolbar showSplit />);

    // Default split is horizontal (side-by-side).
    expect(screen.getByTestId("integrated-split-horizontal")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("integrated-split-vertical"));
    expect(useLayoutSettingsStore.getState().integratedSplit).toBe("vertical");
    expect(screen.getByTestId("integrated-split-vertical")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
