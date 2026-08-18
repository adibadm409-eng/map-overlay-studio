import { useEffect, useRef } from "react";
import { applyTwoFingerGesture, type OverlayTransform } from "@/lib/overlayMath";

type GeoOverlayProps = {
  map: google.maps.Map | null;
  imageUrl: string | null;
  transform: OverlayTransform;
  locked: boolean;
  opacity: number;
  onTransformChange: (next: OverlayTransform) => void;
};

function createRasterOverlay(
  map: google.maps.Map,
  imageUrl: string,
  transform: OverlayTransform,
  locked: boolean,
  opacity: number,
  onTransformChange: (next: OverlayTransform) => void,
) {
  class RasterOverlay extends google.maps.OverlayView {
    private root?: HTMLDivElement;
    private image?: HTMLImageElement;
    private imageRatio = 1;
    private transform: OverlayTransform;
    private locked: boolean;
    private opacity: number;
    private pointers = new Map<number, { x: number; y: number }>();
    private dragStart?: { transform: OverlayTransform; point: { x: number; y: number } };
    private gestureStart?: { transform: OverlayTransform; distance: number; angle: number };

    constructor() {
      super();
      this.transform = transform;
      this.locked = locked;
      this.opacity = opacity;
      this.setMap(map);
    }

    public update(nextTransform: OverlayTransform, nextLocked: boolean, nextOpacity: number) {
      this.transform = nextTransform;
      this.locked = nextLocked;
      this.opacity = nextOpacity;
      this.applyLockState();
      this.draw();
    }

    public onAdd() {
      this.root = document.createElement("div");
      this.root.setAttribute("aria-label", "طبقة المخطط الهندسي");
      this.root.className = "geo-overlay";
      this.root.style.position = "absolute";
      this.root.style.transformOrigin = "center";
      this.root.style.touchAction = "none";
      this.root.style.cursor = "grab";
      this.root.style.opacity = String(this.opacity);
      this.root.style.filter = "drop-shadow(0 12px 18px rgba(9, 20, 33, 0.28))";

      this.image = document.createElement("img");
      this.image.src = imageUrl;
      this.image.alt = "المخطط الهندسي المسند";
      this.image.draggable = false;
      this.image.style.width = "100%";
      this.image.style.height = "100%";
      this.image.style.objectFit = "contain";
      this.image.style.userSelect = "none";
      this.image.onload = () => {
        this.imageRatio = this.image?.naturalWidth && this.image?.naturalHeight
          ? this.image.naturalHeight / this.image.naturalWidth
          : 1;
        this.draw();
      };

      this.root.appendChild(this.image);
      this.installDragHandler();
      this.getPanes()?.overlayMouseTarget.appendChild(this.root);
      this.applyLockState();
    }

    public draw() {
      if (!this.root) return;
      const projection = this.getProjection();
      if (!projection) return;
      const center = new google.maps.LatLng(this.transform.lat, this.transform.lng);
      const eastPoint = new google.maps.LatLng(this.transform.lat, this.transform.lng + this.transform.spanLng);
      const centerPixel = projection.fromLatLngToDivPixel(center);
      const eastPixel = projection.fromLatLngToDivPixel(eastPoint);
      if (!centerPixel || !eastPixel) return;
      const width = Math.max(32, Math.abs(eastPixel.x - centerPixel.x));
      this.root.style.left = `${centerPixel.x}px`;
      this.root.style.top = `${centerPixel.y}px`;
      this.root.style.width = `${width}px`;
      this.root.style.height = `${width * this.imageRatio}px`;
      this.root.style.transform = `translate(-50%, -50%) rotate(${this.transform.rotation}deg)`;
    }

    public onRemove() {
      this.root?.remove();
      this.root = undefined;
    }

    private applyLockState() {
      if (!this.root) return;
      this.root.style.opacity = String(this.opacity);
      this.root.style.pointerEvents = this.locked ? "none" : "auto";
      this.root.style.cursor = this.locked ? "default" : "grab";
      this.root.style.outline = this.locked ? "none" : "2px solid rgba(10, 128, 117, 0.72)";
      this.root.style.outlineOffset = "3px";
    }

    private installDragHandler() {
      if (!this.root) return;
      const getPairMetrics = () => {
        const [first, second] = Array.from(this.pointers.values());
        if (!first || !second) return null;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        return { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
      };

      const commit = (next: OverlayTransform) => {
        this.transform = next;
        onTransformChange(next);
      };

      this.root.addEventListener("pointerdown", event => {
        if (this.locked) return;
        event.preventDefault();
        event.stopPropagation();
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.root?.setPointerCapture(event.pointerId);
        if (this.root) this.root.style.cursor = "grabbing";

        if (this.pointers.size === 1) {
          this.dragStart = { transform: { ...this.transform }, point: { x: event.clientX, y: event.clientY } };
          this.gestureStart = undefined;
        } else if (this.pointers.size === 2) {
          const metrics = getPairMetrics();
          if (metrics) this.gestureStart = { transform: { ...this.transform }, ...metrics };
          this.dragStart = undefined;
        }
      });

      this.root.addEventListener("pointermove", event => {
        if (!this.pointers.has(event.pointerId) || this.locked) return;
        event.preventDefault();
        event.stopPropagation();
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (this.pointers.size >= 2 && this.gestureStart) {
          const metrics = getPairMetrics();
          if (!metrics) return;
          commit(applyTwoFingerGesture(this.gestureStart.transform, {
            initialDistance: this.gestureStart.distance,
            currentDistance: metrics.distance,
            initialAngle: this.gestureStart.angle,
            currentAngle: metrics.angle,
          }));
          return;
        }

        if (this.pointers.size !== 1 || !this.dragStart) return;
        const projection = this.getProjection();
        if (!projection) return;
        const startPixel = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(this.dragStart.transform.lat, this.dragStart.transform.lng),
        );
        if (!startPixel) return;
        const nextLatLng = projection.fromDivPixelToLatLng(
          new google.maps.Point(
            startPixel.x + event.clientX - this.dragStart.point.x,
            startPixel.y + event.clientY - this.dragStart.point.y,
          ),
        );
        if (!nextLatLng) return;
        commit({ ...this.dragStart.transform, lat: nextLatLng.lat(), lng: nextLatLng.lng() });
      });

      const finishPointer = (event: PointerEvent) => {
        this.pointers.delete(event.pointerId);
        if (this.root?.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
        this.gestureStart = undefined;
        if (this.pointers.size === 1) {
          const remaining = Array.from(this.pointers.values())[0];
          if (remaining) this.dragStart = { transform: { ...this.transform }, point: remaining };
        } else {
          this.dragStart = undefined;
          if (this.root) this.root.style.cursor = "grab";
        }
      };

      this.root.addEventListener("pointerup", finishPointer);
      this.root.addEventListener("pointercancel", finishPointer);
    }
  }

  return new RasterOverlay();
}

export function GeoOverlay({ map, imageUrl, transform, locked, opacity, onTransformChange }: GeoOverlayProps) {
  const overlayRef = useRef<google.maps.OverlayView & { update?: (nextTransform: OverlayTransform, nextLocked: boolean, nextOpacity: number) => void } | null>(null);

  useEffect(() => {
    if (!map || !imageUrl) {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      return;
    }
    overlayRef.current?.setMap(null);
    overlayRef.current = createRasterOverlay(map, imageUrl, transform, locked, opacity, onTransformChange);
    return () => {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
    };
  }, [map, imageUrl, onTransformChange]);

  useEffect(() => {
    overlayRef.current?.update?.(transform, locked, opacity);
  }, [transform, locked, opacity]);

  return null;
}
