import { describe, it, expect } from "vitest";
import { extForMime, makeImageFilename, parseDataUri } from "./image-persist";

describe("extForMime", () => {
  it("maps known mimes", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/svg+xml")).toBe("svg");
  });
  it("falls back to png", () => {
    expect(extForMime("application/octet-stream")).toBe("png");
    expect(extForMime("")).toBe("png");
  });
});

describe("makeImageFilename", () => {
  it("formats timestamp + index + ext", () => {
    const d = new Date(2026, 5, 16, 9, 5, 3); // 2026-06-16 09:05:03
    expect(makeImageFilename(d, 1, "png")).toBe("image-20260616-090503-1.png");
  });
});

describe("parseDataUri", () => {
  it("parses base64 data uri", () => {
    const r = parseDataUri("data:image/png;base64,iVBORw0KGgo=");
    expect(r).toEqual({ mime: "image/png", base64: "iVBORw0KGgo=" });
  });
  it("returns null for non-data uri", () => {
    expect(parseDataUri("blob:abc")).toBeNull();
    expect(parseDataUri("foo.png")).toBeNull();
  });
});
