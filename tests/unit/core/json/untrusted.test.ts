import {
  isRecord,
  isoTimestampMillis,
  readBoolean,
  readCount,
  readRecord,
  readString,
} from "@/src/core/json/untrusted";

describe("untrusted JSON readers", () => {
  const node: Record<string, unknown> = {
    child: { a: 1 },
    list: [1],
    text: "hi",
    flag: true,
    count: 3,
    negative: -1,
    fraction: 1.5,
    numericText: "3",
  };

  it("tells records from arrays and primitives", () => {
    expect(isRecord({})).toBe(true);
    for (const value of [null, undefined, [], "x", 1, true]) {
      expect(isRecord(value)).toBe(false);
    }
  });

  it("reads each type only when the value has it", () => {
    expect(readRecord(node, "child")).toEqual({ a: 1 });
    expect(readRecord(node, "list")).toBeUndefined();
    expect(readString(node, "text")).toBe("hi");
    expect(readString(node, "count")).toBeUndefined();
    expect(readBoolean(node, "flag")).toBe(true);
    expect(readBoolean(node, "text")).toBeUndefined();
    expect(readCount(node, "count")).toBe(3);
    for (const key of ["negative", "fraction", "numericText", "missing"]) {
      expect(readCount(node, key)).toBeUndefined();
    }
    expect(readString(undefined, "text")).toBeUndefined();
  });

  it("parses ISO date-times only", () => {
    expect(isoTimestampMillis("2026-10-21T18:44:55.442Z")).toBe(
      Date.UTC(2026, 9, 21, 18, 44, 55, 442),
    );
    for (const value of ["yesterday", "2026-10-21", "1970-01-01T00:00:00Z", "", undefined]) {
      expect(isoTimestampMillis(value)).toBeUndefined();
    }
  });
});
