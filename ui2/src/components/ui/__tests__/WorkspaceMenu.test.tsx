import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceMenu } from "../WorkspaceMenu";

const {
  mockPromptLayoutSaveName,
  mockPromptLayoutRename,
  mockConfirmLayoutDeletion,
  mockShowError,
} = vi.hoisted(() => ({
  mockPromptLayoutSaveName: vi.fn(),
  mockPromptLayoutRename: vi.fn(),
  mockConfirmLayoutDeletion: vi.fn(),
  mockShowError: vi.fn(),
}));

const workspaceStoreState = vi.hoisted(() => ({
  activeWorkspaceId: null as string | null,
  workspaces: new Map<string, { type: string }>(),
}));

const nav = vi.hoisted(() => ({
  openNewView: vi.fn(async () => "view"),
  openTool: vi.fn(async () => "tool"),
  setCurrentTabLayout: vi.fn(),
  nativeMenuOwnsNavigationShortcuts: vi.fn(() => false),
}));

const registered = vi.hoisted(
  () => [] as Array<{ id: string; key: string; handler: () => void }>,
);

const layoutStoreState = vi.hoisted(() => ({
  layouts: [
    {
      id: "layout-1",
      name: "Layout One",
      schemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      layoutConfig: { root: {} },
    },
  ],
  activeLayoutId: "layout-1",
  lastError: null as string | null,
  saveCurrentLayout: vi.fn(),
  loadLayout: vi.fn(),
  renameLayout: vi.fn(),
  deleteLayout: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock("@/services/ConfirmationService", () => ({
  getConfirmationService: () => ({
    promptLayoutSaveName: mockPromptLayoutSaveName,
    promptLayoutRename: mockPromptLayoutRename,
    confirmLayoutDeletion: mockConfirmLayoutDeletion,
    showError: mockShowError,
  }),
}));

vi.mock("@/services/KeyboardShortcutService", () => ({
  getKeyboardShortcutService: () => ({
    register: vi.fn((shortcut: { id: string; key: string; handler: () => void }) => {
      registered.push(shortcut);
      return vi.fn();
    }),
  }),
}));

vi.mock("@/services/workspaceNavigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/workspaceNavigation")>()),
  ...nav,
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: (
    selector: (state: typeof workspaceStoreState) => unknown,
  ) => selector(workspaceStoreState),
}));

vi.mock("@/stores/layoutLibraryStore", () => ({
  useLayoutLibraryStore: (
    selector: (state: typeof layoutStoreState) => unknown,
  ) => selector(layoutStoreState),
  getLayoutLibraryLastError: () => layoutStoreState.lastError,
}));

vi.mock("../DropdownMenu", () => ({
  DropdownMenu: ({
    trigger,
    items,
  }: {
    trigger: React.ReactNode;
    items: Array<{
      id: string;
      label?: React.ReactNode;
      separator?: boolean;
      header?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }>;
  }) => (
    <div>
      <div>{trigger}</div>
      <div>
        {items.map((item) => {
          if (item.separator || item.header) {
            return null;
          }
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  ),
}));

describe("WorkspaceMenu", () => {
  beforeEach(() => {
    workspaceStoreState.activeWorkspaceId = null;
    workspaceStoreState.workspaces = new Map();
    Object.values(nav).forEach((fn) => fn.mockClear());
    nav.nativeMenuOwnsNavigationShortcuts.mockReturnValue(false);
    registered.length = 0;

    layoutStoreState.layouts = [
      {
        id: "layout-1",
        name: "Layout One",
        schemaVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        layoutConfig: { root: {} },
      },
    ];
    layoutStoreState.activeLayoutId = "layout-1";
    layoutStoreState.lastError = null;
    layoutStoreState.saveCurrentLayout.mockReset();
    layoutStoreState.loadLayout.mockReset();
    layoutStoreState.renameLayout.mockReset();
    layoutStoreState.deleteLayout.mockReset();
    layoutStoreState.clearError.mockReset();
    mockPromptLayoutSaveName.mockReset();
    mockPromptLayoutRename.mockReset();
    mockConfirmLayoutDeletion.mockReset();
    mockShowError.mockReset();
  });

  it("offers New view and the three tools, not the retired view presets", () => {
    render(<WorkspaceMenu />);

    for (const label of ["New view", "Set studio", "BIDS", "Analysis"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ["Read", "Explore", "Analyze", "Compare"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("lists module tools after the core tools, labelled with a stage that is not stable", async () => {
    const { registerFixtureModule } = await import("@/modules/__tests__/fixtureModule");
    registerFixtureModule();
    render(<WorkspaceMenu />);
    const fixture = screen.getByText("Fixture");
    expect(fixture.parentElement).toHaveTextContent("FixturePreview");
    fireEvent.click(fixture);
    expect(nav.openTool).toHaveBeenCalledWith("fixture.tool");
  });

  it("New view opens a tab; a tool opens (or refocuses) its tab", () => {
    render(<WorkspaceMenu />);

    fireEvent.click(screen.getByText("New view"));
    expect(nav.openNewView).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Analysis"));
    expect(nav.openTool).toHaveBeenCalledWith("analysis-workbench");
  });

  it("registers Cmd/Ctrl+T, +1–4 (current tab layout) and +5/6 (tools) in the browser build", () => {
    render(<WorkspaceMenu />);

    const byId = new Map(registered.map((r) => [r.id, r]));
    expect(byId.get("workspace.newView.meta")?.key).toBe("t");
    const layoutKeys = ["orthogonal", "integrated", "mosaic", "compare"].map(
      (mode) => byId.get(`workspace.layout.${mode}.ctrl`)?.key,
    );
    expect(layoutKeys).toEqual(["1", "2", "3", "4"]);
    expect(byId.get("workspace.tool.set-studio.meta")?.key).toBe("5");
    expect(byId.get("workspace.tool.bids-explorer.meta")?.key).toBe("6");

    byId.get("workspace.layout.mosaic.meta")!.handler();
    expect(nav.setCurrentTabLayout).toHaveBeenCalledWith("mosaic");
    expect(nav.openNewView).not.toHaveBeenCalled();
  });

  it("leaves the accelerators to the native menu in the desktop shell", () => {
    nav.nativeMenuOwnsNavigationShortcuts.mockReturnValue(true);
    render(<WorkspaceMenu />);
    expect(registered).toHaveLength(0);
  });

  it("routes save through the prompt helper", () => {
    mockPromptLayoutSaveName.mockResolvedValue("Saved Layout");
    layoutStoreState.saveCurrentLayout.mockReturnValue(true);

    render(<WorkspaceMenu />);

    fireEvent.click(
      screen.getByRole("button", { name: "Save Current Layout…" }),
    );

    return waitFor(() => {
      expect(mockPromptLayoutSaveName).toHaveBeenCalledTimes(1);
      expect(layoutStoreState.saveCurrentLayout).toHaveBeenCalledWith(
        "Saved Layout",
      );
    });
  });

  it("routes rename through the prompt helper", () => {
    mockPromptLayoutRename.mockResolvedValue("Renamed Layout");
    layoutStoreState.renameLayout.mockReturnValue(true);

    render(<WorkspaceMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Rename: Layout One" }));

    return waitFor(() => {
      expect(mockPromptLayoutRename).toHaveBeenCalledWith("Layout One");
      expect(layoutStoreState.renameLayout).toHaveBeenCalledWith(
        "layout-1",
        "Renamed Layout",
      );
    });
  });

  it("routes deletion through the confirmation helper", async () => {
    mockConfirmLayoutDeletion.mockResolvedValue(true);
    layoutStoreState.deleteLayout.mockReturnValue(true);

    render(<WorkspaceMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Delete: Layout One" }));

    await waitFor(() => {
      expect(mockConfirmLayoutDeletion).toHaveBeenCalledWith("Layout One");
      expect(layoutStoreState.deleteLayout).toHaveBeenCalledWith("layout-1");
    });
  });

  it("shows and clears the last error when a save fails", () => {
    mockPromptLayoutSaveName.mockResolvedValue("Saved Layout");
    layoutStoreState.saveCurrentLayout.mockReturnValue(false);
    layoutStoreState.lastError = "Layout failed to save.";

    render(<WorkspaceMenu />);

    fireEvent.click(
      screen.getByRole("button", { name: "Save Current Layout…" }),
    );

    return waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith("Layout failed to save.");
      expect(layoutStoreState.clearError).toHaveBeenCalledTimes(1);
    });
  });
});
