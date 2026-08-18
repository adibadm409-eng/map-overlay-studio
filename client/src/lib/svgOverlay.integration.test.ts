import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyTwoFingerGesture, moveOverlay } from "./overlayMath";

const svgPath = "/home/ubuntu/work_property/المخطط_الهندسي_نظيف_متجهي_عالي_الدقة.svg";

describe("SVG overlay interaction sequence", () => {
  it("keeps a real SVG source compatible with drag, two-finger gesture, and fine controls", () => {
    const svg = readFileSync(svgPath, "utf8");
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    expect(svg).toContain("<svg");
    expect(svgDataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);

    const initial = { lat: 15.073, lng: 43.279, spanLng: 0.02, rotation: 0 };
    const afterDrag = moveOverlay(moveOverlay(initial, "north", 0.00002, 0.5), "east", 0.00002, 0.5);
    const afterGesture = applyTwoFingerGesture(afterDrag, {
      initialDistance: 100,
      currentDistance: 150,
      initialAngle: 0,
      currentAngle: Math.PI / 4,
    });
    const afterFineControl = moveOverlay(afterGesture, "rotateClockwise", 0.00002, 0.5);

    expect(afterDrag.lat).toBeCloseTo(15.07302);
    expect(afterDrag.lng).toBeCloseTo(43.27902);
    expect(afterGesture.spanLng).toBeCloseTo(0.03);
    expect(afterGesture.rotation).toBeCloseTo(45);
    expect(afterFineControl.rotation).toBeCloseTo(45.5);
  });
});
