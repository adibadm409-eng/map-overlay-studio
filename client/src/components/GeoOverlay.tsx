import { useEffect, useRef } from "react";
import type { OverlayTransform } from "@/lib/overlayMath";

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
      this.root.addEventListener("pointerdown", event => {
        if (this.locked) return;
        event.preventDefault();
        event.stopPropagation();
        const startingTransform = { ...this.transform };
        const startingPoint = { x: event.clientX, y: event.clientY };
        this.root?.setPointerCapture(event.pointerId);
        if (this.root) this.root.style.cursor = "grabbing";

        const move = (moveEvent: PointerEvent) => {
          const projection = this.getProjection();
          if (!projection) return;
          const startPixel = projection.fromLatLngToDivPixel(
            new google.maps.LatLng(startingTransform.lat, startingTransform.lng),
          );
          if (!startPixel) return;
          const nextLatLng = projection.fromDivPixelToLatLng(
            new google.maps.Point(
              startPixel.x + moveEvent.clientX - startingPoint.x,
              startPixel.y + moveEvent.clientY - startingPoint.y,
            ),
          );
          if (!nextLatLng) return;
          onTransformChange({ ...startingTransform, lat: nextLatLng.lat(), lng: nextLatLng.lng() });
        };

        const end = () => {
          if (this.root) this.root.style.cursor = "grab";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
      });
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
