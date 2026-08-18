export type OverlayTransform = {
  lat: number;
  lng: number;
  spanLng: number;
  rotation: number;
};

export type PrecisionAction =
  | "north"
  | "south"
  | "east"
  | "west"
  | "rotateClockwise"
  | "rotateCounterClockwise"
  | "zoomIn"
  | "zoomOut";

export function normalizeRotation(rotation: number) {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function moveOverlay(
  transform: OverlayTransform,
  action: PrecisionAction,
  movementStep: number,
  rotationStep: number,
): OverlayTransform {
  const next = { ...transform };

  switch (action) {
    case "north":
      next.lat += movementStep;
      break;
    case "south":
      next.lat -= movementStep;
      break;
    case "east":
      next.lng += movementStep;
      break;
    case "west":
      next.lng -= movementStep;
      break;
    case "rotateClockwise":
      next.rotation = normalizeRotation(next.rotation + rotationStep);
      break;
    case "rotateCounterClockwise":
      next.rotation = normalizeRotation(next.rotation - rotationStep);
      break;
    case "zoomIn":
      next.spanLng = Math.max(0.00002, next.spanLng * (1 - rotationStep / 100));
      break;
    case "zoomOut":
      next.spanLng = Math.min(2, next.spanLng * (1 + rotationStep / 100));
      break;
  }

  return next;
}

export function applyTwoFingerGesture(
  transform: OverlayTransform,
  gesture: { initialDistance: number; currentDistance: number; initialAngle: number; currentAngle: number },
): OverlayTransform {
  const scale = gesture.initialDistance > 0 ? gesture.currentDistance / gesture.initialDistance : 1;
  const rotationDelta = ((gesture.currentAngle - gesture.initialAngle) * 180) / Math.PI;
  return {
    ...transform,
    spanLng: Math.max(0.00002, Math.min(2, transform.spanLng * scale)),
    rotation: normalizeRotation(transform.rotation + rotationDelta),
  };
}

export function getMercatorY(latitude: number) {
  const clipped = Math.max(-85, Math.min(85, latitude));
  const radians = (clipped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export type GeoBounds = { north: number; south: number; east: number; west: number };

function longitudeSpan(bounds: GeoBounds) {
  return bounds.east < bounds.west ? bounds.east + 360 - bounds.west : bounds.east - bounds.west;
}

export function getStaticMapZoom(bounds: GeoBounds, maxWidth: number, maxHeight: number) {
  const xFraction = Math.max(longitudeSpan(bounds) / 360, 0.00000001);
  const yFraction = Math.max(
    Math.abs(getMercatorY(bounds.north) - getMercatorY(bounds.south)) / (2 * Math.PI),
    0.00000001,
  );
  const zoomForWidth = Math.log2(maxWidth / (256 * xFraction));
  const zoomForHeight = Math.log2(maxHeight / (256 * yFraction));
  return Math.max(1, Math.min(20, Math.floor(Math.min(zoomForWidth, zoomForHeight))));
}

export function getExportPixelDimensions(bounds: GeoBounds, zoom: number) {
  const worldPixels = 256 * 2 ** zoom;
  const width = Math.max(1, Math.ceil((longitudeSpan(bounds) / 360) * worldPixels));
  const height = Math.max(
    1,
    Math.ceil((Math.abs(getMercatorY(bounds.north) - getMercatorY(bounds.south)) / (2 * Math.PI)) * worldPixels),
  );
  return { width, height };
}

export type StaticTile = { column: number; row: number; lat: number; lng: number };

export type HighResolutionExportPlan = {
  zoom: number;
  tileSize: number;
  columns: number;
  rows: number;
  output: { width: number; height: number };
  crop: { x: number; y: number };
  tiles: StaticTile[];
};

export function getPdfPageSizeAtDpi(pixelSize: { width: number; height: number }, dpi: number = 300) {
  const pointsPerInch = 72;
  return {
    width: (pixelSize.width / dpi) * pointsPerInch,
    height: (pixelSize.height / dpi) * pointsPerInch,
  };
}

function worldPixelToLatLng(x: number, y: number, worldSize: number) {
  const wrappedX = ((x % worldSize) + worldSize) % worldSize;
  const lng = (wrappedX / worldSize) * 360 - 180;
  const mercatorY = (1 - (2 * y) / worldSize) * Math.PI;
  const lat = (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI;
  return { lat, lng };
}

/** Creates a tile mosaic that covers the selected frame at 2× Static Maps scale. */
export function createHighResolutionExportPlan(bounds: GeoBounds, extraZoom: number = 2): HighResolutionExportPlan {
  const tileSize = 1280;
  const baseZoom = getStaticMapZoom(bounds, 640, 640);
  const zoom = Math.min(20, baseZoom + extraZoom);
  const logical = getExportPixelDimensions(bounds, zoom);
  const output = { width: logical.width * 2, height: logical.height * 2 };
  const columns = Math.ceil(output.width / tileSize);
  const rows = Math.ceil(output.height / tileSize);
  if (columns * rows > 16) throw new Error("نطاق التصدير واسع جداً لهذه الدقة. صغّر الإطار ثم أعد المحاولة.");

  const mosaicWidth = columns * tileSize;
  const mosaicHeight = rows * tileSize;
  const crop = { x: Math.floor((mosaicWidth - output.width) / 2), y: Math.floor((mosaicHeight - output.height) / 2) };
  const worldSize = 256 * 2 ** zoom * 2;
  const span = longitudeSpan(bounds);
  const centreLng = bounds.west + span / 2;
  const centreX = (((centreLng + 180) / 360) * worldSize + worldSize) % worldSize;
  const northY = ((1 - getMercatorY(bounds.north) / Math.PI) / 2) * worldSize;
  const southY = ((1 - getMercatorY(bounds.south) / Math.PI) / 2) * worldSize;
  const centreY = (northY + southY) / 2;
  const mosaicTopLeft = { x: centreX - mosaicWidth / 2, y: centreY - mosaicHeight / 2 };
  const tiles: StaticTile[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = worldPixelToLatLng(
        mosaicTopLeft.x + (column + 0.5) * tileSize,
        mosaicTopLeft.y + (row + 0.5) * tileSize,
        worldSize,
      );
      tiles.push({ column, row, ...point });
    }
  }

  return { zoom, tileSize, columns, rows, output, crop, tiles };
}

export function latLngToMapPixel(
  point: { lat: number; lng: number },
  mapBounds: GeoBounds,
  size: { width: number; height: number },
) {
  const west = mapBounds.west;
  const east = mapBounds.east < west ? mapBounds.east + 360 : mapBounds.east;
  const lng = point.lng < west ? point.lng + 360 : point.lng;
  const x = ((lng - west) / (east - west)) * size.width;
  const northY = getMercatorY(mapBounds.north);
  const southY = getMercatorY(mapBounds.south);
  const y = ((northY - getMercatorY(point.lat)) / (northY - southY)) * size.height;
  return { x, y };
}
