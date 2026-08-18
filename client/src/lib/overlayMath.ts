export type OverlayTransform = {
  lat: number;
  lng: number;
  spanLng: number;
  rotation: number;
};

export type CalibrationSnapshot = {
  transform: OverlayTransform;
  overlayOpacity?: number;
  mapZoom?: number;
  roadsVisible?: boolean;
};

export type CalibrationParseResult =
  | { ok: true; calibration: CalibrationSnapshot }
  | { ok: false; message: string };

export type AppliedCalibrationState = {
  transform: OverlayTransform;
  mapSnapshot: { lat: number; lng: number; zoom: number };
  overlayOpacity: number;
  roadsVisible: boolean;
};

const CALIBRATION_HEADER = "MAP_OVERLAY_CALIBRATION_V1";

type NumberRead = { value: number | undefined } | { error: string };

function readNumber(fields: Map<string, string>, key: string, required: boolean): NumberRead {
  const raw = fields.get(key);
  if (raw === undefined || raw === "") return required ? { error: `القيمة ${key} مطلوبة.` } : { value: undefined };
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? { value } : { error: `القيمة ${key} يجب أن تكون رقماً صحيحاً.` };
}

export function validateCalibrationSnapshot(calibration: CalibrationSnapshot): string | null {
  const { transform, overlayOpacity, mapZoom } = calibration;
  if (![transform.lat, transform.lng, transform.spanLng, transform.rotation].every(Number.isFinite)) return "بيانات المعايرة غير مكتملة أو غير صالحة.";
  if (transform.lat < -85 || transform.lat > 85 || transform.lng < -180 || transform.lng > 180) return "إحداثيات المعايرة خارج النطاق المسموح.";
  if (transform.spanLng < 0.00002 || transform.spanLng > 2) return "مقياس المعايرة خارج النطاق المسموح.";
  if (overlayOpacity !== undefined && (!Number.isFinite(overlayOpacity) || overlayOpacity < 10 || overlayOpacity > 100)) return "شفافية المعايرة غير صالحة.";
  if (mapZoom !== undefined && (!Number.isFinite(mapZoom) || mapZoom < 1 || mapZoom > 20)) return "مستوى تكبير الخريطة غير صالح.";
  return null;
}

export function applyCalibrationSnapshot(
  current: { mapSnapshot: { lat: number; lng: number; zoom: number }; overlayOpacity: number; roadsVisible: boolean },
  calibration: CalibrationSnapshot,
): AppliedCalibrationState {
  return {
    transform: calibration.transform,
    mapSnapshot: {
      lat: calibration.transform.lat,
      lng: calibration.transform.lng,
      zoom: calibration.mapZoom ?? current.mapSnapshot.zoom,
    },
    overlayOpacity: calibration.overlayOpacity ?? current.overlayOpacity,
    roadsVisible: calibration.roadsVisible ?? current.roadsVisible,
  };
}

export function formatCalibrationText(calibration: CalibrationSnapshot) {
  const { transform, overlayOpacity, mapZoom, roadsVisible } = calibration;
  return [
    CALIBRATION_HEADER,
    `lat=${transform.lat.toFixed(6)}`,
    `lng=${transform.lng.toFixed(6)}`,
    `spanLng=${transform.spanLng.toFixed(6)}`,
    `rotation=${normalizeRotation(transform.rotation).toFixed(2)}`,
    `opacity=${Math.round(overlayOpacity ?? 72)}`,
    `mapZoom=${Math.round(mapZoom ?? 14)}`,
    `roadsVisible=${roadsVisible ?? true}`,
  ].join("\n");
}

export function parseCalibrationText(text: string): CalibrationParseResult {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, message: "الصق نص المعايرة أولاً." };
  if (lines[0] === CALIBRATION_HEADER) lines.shift();
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z]+)\s*[:=]\s*(.+)$/);
    if (match) fields.set(match[1]!.toLowerCase(), match[2]!.trim());
  }

  const lat = readNumber(fields, "lat", true);
  const lng = readNumber(fields, "lng", true);
  const spanLng = readNumber(fields, "spanlng", true);
  const rotation = readNumber(fields, "rotation", true);
  if ("error" in lat) return { ok: false, message: lat.error };
  if ("error" in lng) return { ok: false, message: lng.error };
  if ("error" in spanLng) return { ok: false, message: spanLng.error };
  if ("error" in rotation) return { ok: false, message: rotation.error };
  if (lat.value! < -85 || lat.value! > 85) return { ok: false, message: "lat يجب أن تقع بين -85 و85." };
  if (lng.value! < -180 || lng.value! > 180) return { ok: false, message: "lng يجب أن تقع بين -180 و180." };
  if (spanLng.value! < 0.00002 || spanLng.value! > 2) return { ok: false, message: "spanLng يجب أن تقع بين 0.00002 و2." };

  const opacity = readNumber(fields, "opacity", false);
  const mapZoom = readNumber(fields, "mapzoom", false);
  if ("error" in opacity) return { ok: false, message: opacity.error };
  if ("error" in mapZoom) return { ok: false, message: mapZoom.error };
  if (opacity.value !== undefined && (opacity.value < 10 || opacity.value > 100)) return { ok: false, message: "opacity يجب أن تقع بين 10 و100." };
  if (mapZoom.value !== undefined && (mapZoom.value < 1 || mapZoom.value > 20)) return { ok: false, message: "mapZoom يجب أن تقع بين 1 و20." };
  const roadsText = fields.get("roadsvisible")?.toLowerCase();
  if (roadsText !== undefined && roadsText !== "true" && roadsText !== "false") return { ok: false, message: "roadsVisible يجب أن تكون true أو false." };

  const calibration: CalibrationSnapshot = {
    transform: {
      lat: lat.value!,
      lng: lng.value!,
      spanLng: spanLng.value!,
      rotation: normalizeRotation(rotation.value!),
    },
    overlayOpacity: opacity.value === undefined ? undefined : Math.round(opacity.value),
    mapZoom: mapZoom.value === undefined ? undefined : Math.round(mapZoom.value),
    roadsVisible: roadsText === undefined ? undefined : roadsText === "true",
  };
  const validationError = validateCalibrationSnapshot(calibration);
  if (validationError) return { ok: false, message: validationError };

  return {
    ok: true,
    calibration,
  };
}

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
