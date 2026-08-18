import { describe, expect, it } from "vitest";
import { applyCalibrationSnapshot, applyTwoFingerGesture, createHighResolutionExportPlan, formatCalibrationText, getExportPixelDimensions, getPdfPageSizeAtDpi, getStaticMapZoom, latLngToMapPixel, moveOverlay, normalizeRotation, parseCalibrationText, validateCalibrationSnapshot } from "./overlayMath";

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

  it("scales and rotates a plan with a two-finger gesture", () => {
    const next = applyTwoFingerGesture(base, {
      initialDistance: 100,
      currentDistance: 150,
      initialAngle: 0,
      currentAngle: Math.PI / 2,
    });
    expect(next.spanLng).toBeCloseTo(0.03);
    expect(next.rotation).toBeCloseTo(90);
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

  it("exports and restores a complete calibration snapshot", () => {
    const text = formatCalibrationText({
      transform: { lat: 15.064953, lng: 43.290696, spanLng: 0.110119, rotation: 359.64 },
      overlayOpacity: 72,
      mapZoom: 15,
      roadsVisible: false,
    });
    const parsed = parseCalibrationText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.calibration.transform).toEqual({ lat: 15.064953, lng: 43.290696, spanLng: 0.110119, rotation: 359.64 });
    expect(parsed.calibration.overlayOpacity).toBe(72);
    expect(parsed.calibration.mapZoom).toBe(15);
    expect(parsed.calibration.roadsVisible).toBe(false);
  });

  it("rejects incomplete or unsafe calibration text", () => {
    expect(parseCalibrationText("lat=15\nlng=43").ok).toBe(false);
    expect(parseCalibrationText("lat=91\nlng=43\nspanLng=0.1\nrotation=0").ok).toBe(false);
    expect(parseCalibrationText("lat=15\nlng=43\nspanLng=0.1\nrotation=0\nroadsVisible=perhaps").ok).toBe(false);
  });

  it("applies a pasted calibration across all map and overlay state values", () => {
    const parsed = parseCalibrationText("lat=15.064953\nlng=43.290696\nspanLng=0.110119\nrotation=359.64\nopacity=72\nmapZoom=15\nroadsVisible=false");
    if (!parsed.ok) throw new Error(parsed.message);
    const applied = applyCalibrationSnapshot({
      mapSnapshot: { lat: 15.073, lng: 43.279, zoom: 14 },
      overlayOpacity: 50,
      roadsVisible: true,
    }, parsed.calibration);
    expect(applied).toEqual({
      transform: { lat: 15.064953, lng: 43.290696, spanLng: 0.110119, rotation: 359.64 },
      mapSnapshot: { lat: 15.064953, lng: 43.290696, zoom: 15 },
      overlayOpacity: 72,
      roadsVisible: false,
    });
  });

  it("detects incomplete calibration data before a copy or apply operation", () => {
    expect(validateCalibrationSnapshot({ transform: { lat: NaN, lng: 43, spanLng: 0.1, rotation: 0 } })).toContain("غير مكتملة");
  });
});
