import { describe, expect, it } from "vitest";

import { column, joinDesignTable } from "@/plotting";
import type { SampleFrame } from "@/plotting";

const base: SampleFrame = {
  columns: [column("member", "nominal"), column("value", "quantitative")],
  rows: [
    { member: "sub01", value: 1.0 },
    { member: "sub02", value: 2.0 },
    { member: "sub03", value: 3.0 },
  ],
};

const table = {
  columns: ["group", "age"],
  rows: [
    { id: "sub01", cells: ["ctrl", "20"] },
    { id: "sub02", cells: ["patient", "30"] },
    // sub03 intentionally absent
  ],
};

describe("joinDesignTable", () => {
  it("joins design columns by member id, inferring roles (numeric -> quantitative)", () => {
    const f = joinDesignTable(base, "member", table);
    expect(f.columns.map((c) => [c.name, c.role])).toEqual([
      ["member", "nominal"],
      ["value", "quantitative"],
      ["group", "nominal"],
      ["age", "quantitative"],
    ]);
    expect(f.rows[0]).toEqual({
      member: "sub01",
      value: 1.0,
      group: "ctrl",
      age: 20,
    });
    expect(f.rows[1]).toEqual({
      member: "sub02",
      value: 2.0,
      group: "patient",
      age: 30,
    });
  });

  it("keeps unmatched base rows with null design cells by default", () => {
    const f = joinDesignTable(base, "member", table);
    expect(f.rows[2]).toEqual({
      member: "sub03",
      value: 3.0,
      group: null,
      age: null,
    });
  });

  it("drops unmatched base rows when keep=false", () => {
    const f = joinDesignTable(base, "member", table, { keep: false });
    expect(f.rows).toHaveLength(2);
  });

  it("honours explicit column roles (numeric column forced nominal stays a string)", () => {
    const f = joinDesignTable(
      base,
      "member",
      { columns: ["age"], rows: [{ id: "sub01", cells: ["20"] }] },
      { roles: { age: "nominal" } },
    );
    expect(f.columns.find((c) => c.name === "age")?.role).toBe("nominal");
    expect(f.rows[0].age).toBe("20");
  });

  it("throws when the key column is absent from the base frame", () => {
    expect(() => joinDesignTable(base, "missing", table)).toThrow();
  });

  it("drops a design column that collides with a base column (base wins, no duplicate)", () => {
    const f = joinDesignTable(base, "member", {
      columns: ["value", "group"],
      rows: [{ id: "sub01", cells: ["999", "ctrl"] }],
    });
    expect(f.columns.filter((c) => c.name === "value")).toHaveLength(1);
    expect(f.columns.map((c) => c.name)).toEqual(["member", "value", "group"]);
    expect(f.rows[0]).toEqual({ member: "sub01", value: 1.0, group: "ctrl" });
  });
});
