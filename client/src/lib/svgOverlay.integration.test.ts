import { describe, expect, it } from "vitest";
import { applyTwoFingerGesture, moveOverlay } from "./overlayMath";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="100" height="80"/></svg>';

describe("SVG overlay interaction sequence", () => {
  it("keeps an SVG source compatible with drag, two-finger gesture, and fine controls", () => {
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    expect(svg).toContain("<svg");
    expect(svgDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);

    const initial = { lat: 12, lng: 45, spanLng: 0.02, rotation: 0 };
    const afterDrag = moveOverlay(moveOverlay(initial, "north", 0.00002, 0.5), "east", 0.00002, 0.5);
    const afterGesture = applyTwoFingerGesture(afterDrag, {
      initialDistance: 100,
      currentDistance: 150,
      initialAngle: 0,
      currentAngle: Math.PI / 4,
    });
    const afterFineControl = moveOverlay(afterGesture, "rotateClockwise", 0.00002, 0.5);

    expect(afterDrag.lat).toBeCloseTo(12.00002);
    expect(afterDrag.lng).toBeCloseTo(45.00002);
    expect(afterGesture.spanLng).toBeCloseTo(0.03);
    expect(afterGesture.rotation).toBeCloseTo(45);
    expect(afterFineControl.rotation).toBeCloseTo(45.5);
  });
});
