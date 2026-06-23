import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ArrangementMenu } from "../ArrangementMenu";
import { useLayoutSettingsStore } from "@/stores/layoutSettingsStore";

describe("ArrangementMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    useLayoutSettingsStore.getState().resetLayoutSettings();
  });

  it("keeps the popover content closed until the trigger is clicked", () => {
    render(<ArrangementMenu />);
    expect(screen.getByTestId("arrangement-menu-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("ortho-arrangement-grid")).toBeNull();
  });

  it("opens the popover and updates the ortho arrangement", () => {
    render(<ArrangementMenu />);
    fireEvent.click(screen.getByTestId("arrangement-menu-trigger"));

    expect(screen.getByTestId("ortho-arrangement-grid")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByTestId("ortho-arrangement-row"));
    expect(useLayoutSettingsStore.getState().orthoArrangement).toBe("row");
  });

  it("hides the split toggle unless showSplit is set", () => {
    const { rerender } = render(<ArrangementMenu />);
    fireEvent.click(screen.getByTestId("arrangement-menu-trigger"));
    expect(screen.queryByTestId("integrated-split-horizontal")).toBeNull();

    rerender(<ArrangementMenu showSplit />);
    // popover already open; the split row should now be present
    expect(
      screen.getByTestId("integrated-split-horizontal"),
    ).toBeInTheDocument();
  });

  it("updates the integrated split when shown", () => {
    render(<ArrangementMenu showSplit />);
    fireEvent.click(screen.getByTestId("arrangement-menu-trigger"));

    fireEvent.click(screen.getByTestId("integrated-split-vertical"));
    expect(useLayoutSettingsStore.getState().integratedSplit).toBe("vertical");
  });
});
