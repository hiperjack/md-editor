import { describe, it, expect } from "vitest";
import { printPageRule, buildPrintDocument } from "./print-doc";

describe("printPageRule", () => {
  it("uses the given orientation", () => {
    expect(printPageRule("landscape")).toBe(
      "@page { size: A4 landscape; margin: 20mm 18mm; }",
    );
    expect(printPageRule("portrait")).toContain("A4 portrait");
  });
});

describe("buildPrintDocument", () => {
  const html =
    '<!DOCTYPE html><html><head><title>x</title></head>' +
    '<body><main class="document">hi</main></body></html>';

  it("injects @page and print CSS before </head>", () => {
    const out = buildPrintDocument(html, "portrait");
    expect(out).toContain("@page { size: A4 portrait");
    expect(out).toContain("print-color-adjust: exact");
    expect(out.indexOf("@page")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain('<main class="document">hi</main>');
  });

  it("reflects orientation", () => {
    expect(buildPrintDocument(html, "landscape")).toContain("A4 landscape");
  });

  it("falls back to prepending when there is no </head>", () => {
    const out = buildPrintDocument("<main>x</main>", "portrait");
    expect(out).toContain("@page { size: A4 portrait");
    expect(out).toContain("<main>x</main>");
  });
});
