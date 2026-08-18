import { jsPDF } from "jspdf";
import { describe, expect, it } from "vitest";
import { getPdfPageSizeAtDpi } from "./overlayMath";

describe("high-resolution PDF output", () => {
  it("creates a non-empty single-page PDF whose MediaBox matches a 300 DPI export canvas", () => {
    const pixels = { width: 1700, height: 2818 };
    const page = getPdfPageSizeAtDpi(pixels);
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: [page.width, page.height],
      compress: true,
    });
    const bytes = pdf.output("arraybuffer");
    const raw = new TextDecoder("latin1").decode(bytes);
    const mediaBox = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);

    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(pdf.getNumberOfPages()).toBe(1);
    expect(mediaBox).not.toBeNull();
    expect(Number(mediaBox?.[1])).toBeCloseTo(page.width, 1);
    expect(Number(mediaBox?.[2])).toBeCloseTo(page.height, 1);
  });
});
