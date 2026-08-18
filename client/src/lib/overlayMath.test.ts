import { describe, expect, it } from "vitest";
import { createHighResolutionExportPlan, getExportPixelDimensions, getPdfPageSizeAtDpi, getStaticMapZoom, latLngToMapPixel, moveOverlay, normalizeRotation } from "./overlayMath";

const base = { lat: 15, lng: 43, spanLng: 0.02, rotation: 0 };

describe("overlay precision controls", () => {
  it("moves the plan in the requested cardinal direction", () => {
    expect(moveOverlay(base, "north", 0.0001, 1).lat).toBeCloseTo(15.0001);
    expect(moveOverlay(base, "west", 0.0001, 1).lng).toBeCloseTo(42.9999);
  });

  it("normalizes rotation and keeps scale positive", () => {
    expect(normalizeRotation(-5)).toBe(355);
    expect(moveOverlay(base, "rotateCounterClockwise", 0.1, 2).rotation).toBe(358);
    expect(moveOverlay({ ...base, spanLng: 0.00002 }, "zoomIn", 1, 20).spanLng).toBe(0.00002);
  });

  it("places the map centre at the centre pixel", () => {
    const pixel = latLngToMapPixel(
      { lat: 0, lng: 0 },
      { north: 10, south: -10, east: 10, west: -10 },
      { width: 1000, height: 500 },
    );
    expect(pixel.x).toBeCloseTo(500);
    expect(pixel.y).toBeCloseTo(250, 0);
  });

  it("fits export bounds in a static map without changing their Mercator aspect ratio", () => {
    const bounds = { north: 15.18, south: 15.01, east: 43.42, west: 43.18 };
    const zoom = getStaticMapZoom(bounds, 640, 640);
    const dimensions = getExportPixelDimensions(bounds, zoom);
    expect(dimensions.width).toBeLessThanOrEqual(640);
    expect(dimensions.height).toBeLessThanOrEqual(640);
    expect(dimensions.width / dimensions.height).toBeGreaterThan(1);
    expect(latLngToMapPixel({ lat: 15.095, lng: 43.3 }, bounds, dimensions).x).toBeCloseTo(dimensions.width / 2, 0);
  });

  it("creates high-resolution tiles that cover the exact export canvas", () => {
    const bounds = { north: 15.18, south: 15.01, east: 43.42, west: 43.18 };
    const plan = createHighResolutionExportPlan(bounds);
    expect(plan.output.width).toBeGreaterThanOrEqual(1600);
    expect(plan.output.height).toBeGreaterThan(0);
    expect(plan.tiles).toHaveLength(plan.columns * plan.rows);
    expect(plan.crop.x).toBeGreaterThanOrEqual(0);
    expect(plan.crop.y).toBeGreaterThanOrEqual(0);
  });

  it("maps the PNG pixel dimensions to a 300 DPI PDF page", () => {
    const page = getPdfPageSizeAtDpi({ width: 1700, height: 2818 });
    expect(page.width).toBeCloseTo(408);
    expect(page.height).toBeCloseTo(676.32);
  });
});
