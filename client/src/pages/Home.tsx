import { GeoOverlay } from "@/components/GeoOverlay";
import { MapView } from "@/components/Map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { get, set } from "idb-keyval";
import { jsPDF } from "jspdf";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Focus,
  Layers3,
  Lock,
  LockKeyhole,
  Map as MapIcon,
  MousePointer2,
  Move,
  RotateCcw,
  RotateCw,
  Route,
  Save,
  ScanLine,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createHighResolutionExportPlan, getPdfPageSizeAtDpi, latLngToMapPixel, moveOverlay, type OverlayTransform, type PrecisionAction } from "@/lib/overlayMath";

type MapSnapshot = { lat: number; lng: number; zoom: number };
type ExportBounds = { north: number; south: number; east: number; west: number };
type SessionSnapshot = {
  fileName: string;
  overlayImage: string;
  transform: OverlayTransform;
  mapSnapshot: MapSnapshot;
  overlayOpacity?: number;
  roadsVisible?: boolean;
};

const INITIAL_MAP: MapSnapshot = { lat: 15.073, lng: 43.279, zoom: 14 };
const INITIAL_OVERLAY: OverlayTransform = {
  lat: INITIAL_MAP.lat,
  lng: INITIAL_MAP.lng,
  spanLng: 0.02,
  rotation: 0,
};

const MODE_LABEL = {
  navigate: "تنقل",
  mapLocked: "قفل خريطة",
  editOverlay: "تحرير مخطط",
  export: "تصدير",
} as const;

function formatCoordinates(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function getBoundsCentre(bounds: ExportBounds) {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("تعذر تحميل الصورة المطلوبة للتصدير."));
    image.src = source;
  });
}

export default function Home() {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [mapSnapshot, setMapSnapshot] = useState<MapSnapshot>(INITIAL_MAP);
  const [mapLocked, setMapLocked] = useState(false);
  const [overlayLocked, setOverlayLocked] = useState(false);
  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [transform, setTransform] = useState<OverlayTransform>(INITIAL_OVERLAY);
  const [precision, setPrecision] = useState(2);
  const [overlayOpacity, setOverlayOpacity] = useState(72);
  const [roadsVisible, setRoadsVisible] = useState(true);
  const [exportBounds, setExportBounds] = useState<ExportBounds | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestored, setIsRestored] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const mapRectangleRef = useRef<google.maps.Rectangle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentMode = isExporting
    ? "export"
    : mapLocked
      ? "mapLocked"
      : overlayImage && !overlayLocked
        ? "editOverlay"
        : "navigate";

  const syncMapSnapshot = useCallback((activeMap: google.maps.Map) => {
    const center = activeMap.getCenter();
    if (!center) return;
    setMapSnapshot({ lat: center.lat(), lng: center.lng(), zoom: activeMap.getZoom() ?? 14 });
  }, []);

  const handleMapReady = useCallback((activeMap: google.maps.Map) => {
    activeMap.setMapTypeId("hybrid");
    activeMap.setOptions({ gestureHandling: "greedy", mapTypeControl: true, fullscreenControl: true });
    setMap(activeMap);
    activeMap.addListener("idle", () => syncMapSnapshot(activeMap));
  }, [syncMapSnapshot]);

  useEffect(() => {
    void get<SessionSnapshot>("map-overlay-studio/session").then(snapshot => {
      if (!snapshot) {
        setIsRestored(true);
        return;
      }
      setFileName(snapshot.fileName);
      setOverlayImage(snapshot.overlayImage);
      setTransform(snapshot.transform);
      setMapSnapshot(snapshot.mapSnapshot);
      setOverlayOpacity(snapshot.overlayOpacity ?? 72);
      setRoadsVisible(snapshot.roadsVisible ?? true);
      setIsRestored(true);
    });
  }, []);

  useEffect(() => {
    if (!map || !isRestored) return;
    map.setCenter({ lat: mapSnapshot.lat, lng: mapSnapshot.lng });
    map.setZoom(mapSnapshot.zoom);
  }, [map, isRestored]);

  useEffect(() => {
    if (!map) return;
    map.setOptions({
      draggable: !mapLocked,
      scrollwheel: !mapLocked,
      keyboardShortcuts: !mapLocked,
      disableDoubleClickZoom: mapLocked,
      gestureHandling: mapLocked ? "none" : "greedy",
      zoomControl: !mapLocked,
    });
  }, [map, mapLocked]);

  useEffect(() => {
    if (!map) return;
    map.setMapTypeId(roadsVisible ? "hybrid" : "satellite");
  }, [map, roadsVisible]);

  const convertPdfToPng = async (file: File) => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("تعذر تجهيز مساحة العرض.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const alpha = pixels.data;
    for (let index = 0; index < alpha.length; index += 4) {
      const red = alpha[index] ?? 0;
      const green = alpha[index + 1] ?? 0;
      const blue = alpha[index + 2] ?? 0;
      if (red > 245 && green > 245 && blue > 245) alpha[index + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const extension = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || extension.endsWith(".pdf");
      const isSvg = file.type === "image/svg+xml" || extension.endsWith(".svg");
      const image = isPdf
        ? await convertPdfToPng(file)
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
      setOverlayImage(image);
      setFileName(file.name);
      setOverlayLocked(false);
      setTransform({ ...INITIAL_OVERLAY, lat: mapSnapshot.lat, lng: mapSnapshot.lng });
      toast.success(isSvg ? "تمت إضافة ملف SVG المتجهي. اسحبه مباشرة فوق الموقع المطلوب." : "تمت إضافة المخطط. اسحبه مباشرة فوق الموقع المطلوب.");
    } catch (error) {
      console.error(error);
      toast.error("تعذر استخراج الصفحة الأولى من الملف المرفوع.");
    } finally {
      event.target.value = "";
    }
  };

  const applyPrecision = (action: PrecisionAction) => {
    if (!overlayImage) {
      toast.error("ارفع المخطط أولاً لتفعيل الضبط الدقيق.");
      return;
    }
    const movementStep = precision * 0.00001;
    const rotationStep = precision * 0.25;
    setTransform(current => moveOverlay(current, action, movementStep, rotationStep));
  };

  const centreOverlay = () => {
    setTransform(current => ({ ...current, lat: mapSnapshot.lat, lng: mapSnapshot.lng }));
  };

  const toggleExportMode = () => {
    if (!map) return;
    if (isExporting) {
      mapRectangleRef.current?.setMap(null);
      mapRectangleRef.current = null;
      setExportBounds(null);
      setIsExporting(false);
      return;
    }
    const bounds = map.getBounds();
    if (!bounds) return;
    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const latPadding = (northEast.lat() - southWest.lat()) * 0.16;
    const lngPadding = (northEast.lng() - southWest.lng()) * 0.16;
    const rectangle = new google.maps.Rectangle({
      map,
      bounds: {
        north: northEast.lat() - latPadding,
        south: southWest.lat() + latPadding,
        east: northEast.lng() - lngPadding,
        west: southWest.lng() + lngPadding,
      },
      editable: true,
      draggable: true,
      strokeColor: "#fb923c",
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: "#fb923c",
      fillOpacity: 0.07,
    });
    const updateBounds = () => {
      const next = rectangle.getBounds();
      if (!next) return;
      setExportBounds({
        north: next.getNorthEast().lat(),
        east: next.getNorthEast().lng(),
        south: next.getSouthWest().lat(),
        west: next.getSouthWest().lng(),
      });
    };
    rectangle.addListener("bounds_changed", updateBounds);
    mapRectangleRef.current = rectangle;
    updateBounds();
    setMapLocked(false);
    setIsExporting(true);
    toast.success("حرّك إطار النطاق أو غيّر حجمه، ثم صدّر النتيجة.");
  };

  const saveSession = async () => {
    if (!overlayImage) {
      toast.error("ارفع مخططاً قبل حفظ حالة الإسناد.");
      return;
    }
    await set("map-overlay-studio/session", { fileName, overlayImage, transform, mapSnapshot, overlayOpacity, roadsVisible });
    toast.success("حُفظت حالة الإسناد الجغرافي على هذا الجهاز.");
  };

  const exportResult = async (format: "png" | "pdf") => {
    if (!map || !exportBounds || !overlayImage) {
      toast.error("فعّل نطاق التصدير وعدّله قبل التحميل.");
      return;
    }
    try {
      const exportPlan = createHighResolutionExportPlan(exportBounds);
      const staticUrls = exportPlan.tiles.map(tile => {
        const staticUrl = new URL("/api/maps/static", window.location.origin);
        staticUrl.searchParams.set("lat", String(tile.lat));
        staticUrl.searchParams.set("lng", String(tile.lng));
        staticUrl.searchParams.set("zoom", String(exportPlan.zoom));
        staticUrl.searchParams.set("width", "640");
        staticUrl.searchParams.set("height", "640");
        staticUrl.searchParams.set("roads", roadsVisible ? "show" : "hide");
        return staticUrl.toString();
      });
      const [mapTiles, planImage] = await Promise.all([Promise.all(staticUrls.map(loadImage)), loadImage(overlayImage)]);
      if (mapTiles.some(tile => tile.naturalWidth !== exportPlan.tileSize || tile.naturalHeight !== exportPlan.tileSize)) {
        throw new Error("تعذر استلام بلاطات الخريطة بالدقة المطلوبة.");
      }
      const outputWidth = exportPlan.output.width;
      const outputHeight = exportPlan.output.height;
      const mosaic = document.createElement("canvas");
      mosaic.width = exportPlan.columns * exportPlan.tileSize;
      mosaic.height = exportPlan.rows * exportPlan.tileSize;
      const mosaicContext = mosaic.getContext("2d");
      if (!mosaicContext) return;
      exportPlan.tiles.forEach((tile, index) => {
        mosaicContext.drawImage(mapTiles[index]!, tile.column * exportPlan.tileSize, tile.row * exportPlan.tileSize);
      });
      const output = document.createElement("canvas");
      output.width = outputWidth;
      output.height = outputHeight;
      const context = output.getContext("2d");
      if (!context) return;
      context.drawImage(mosaic, exportPlan.crop.x, exportPlan.crop.y, outputWidth, outputHeight, 0, 0, outputWidth, outputHeight);

      const overlayCentre = latLngToMapPixel(
        { lat: transform.lat, lng: transform.lng },
        exportBounds,
        { width: outputWidth, height: outputHeight },
      );
      const overlaySpanPixel = Math.abs(
        latLngToMapPixel(
          { lat: transform.lat, lng: transform.lng + transform.spanLng },
          exportBounds,
          { width: outputWidth, height: outputHeight },
        ).x - overlayCentre.x,
      );
      const planWidth = Math.max(20, overlaySpanPixel);
      const planHeight = planWidth * (planImage.naturalHeight / planImage.naturalWidth);
      context.save();
      context.translate(overlayCentre.x, overlayCentre.y);
      context.rotate((transform.rotation * Math.PI) / 180);
      context.drawImage(planImage, -planWidth / 2, -planHeight / 2, planWidth, planHeight);
      context.restore();
      const dataUrl = output.toDataURL("image/png", 1);
      const safeStem = (fileName || "map-overlay").replace(/\.[^/.]+$/, "").replace(/[^\w-]+/g, "-");
      const safeName = safeStem.replace(/^-+|-+$/g, "") || "map-overlay";
      const exportAudit = {
        generatedAt: new Date().toISOString(),
        pixels: { width: output.width, height: output.height },
        exportBounds,
        mapZoom: exportPlan.zoom,
        tileCount: exportPlan.tiles.length,
      };
      if (format === "png") {
        window.localStorage.setItem("map-overlay-studio/last-export", JSON.stringify({
          ...exportAudit,
          format: "png",
          dataUrlLength: dataUrl.length,
        }));
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `${safeName}-overlay.png`;
        link.click();
      } else {
        const isLandscape = output.width >= output.height;
        const { width: pageWidth, height: pageHeight } = getPdfPageSizeAtDpi({ width: output.width, height: output.height });
        const pdf = new jsPDF({
          orientation: isLandscape ? "landscape" : "portrait",
          unit: "pt",
          format: [pageWidth, pageHeight],
          compress: true,
        });
        pdf.addImage(dataUrl, "PNG", 0, 0, pageWidth, pageHeight, undefined, "SLOW");
        const pdfBytes = pdf.output("arraybuffer");
        const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
        const pdfText = new TextDecoder("latin1").decode(pdfBytes);
        const mediaBox = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
        window.localStorage.setItem("map-overlay-studio/last-export", JSON.stringify({
          ...exportAudit,
          format: "pdf",
          pdfBytes: pdfBytes.byteLength,
          pagePoints: { width: pageWidth, height: pageHeight },
          mediaBox: mediaBox ? { width: Number(mediaBox[1]), height: Number(mediaBox[2]) } : null,
        }));
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(pdfBlob);
        link.href = objectUrl;
        link.download = `${safeName}-overlay.pdf`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      toast.success(`تم تجهيز ملف ${format.toUpperCase()} بدقة عالية.`);
    } catch (error) {
      console.error(error);
      toast.error("تعذر تصدير المشهد. جرّب مرة أخرى بعد اكتمال تحميل الخريطة.");
    }
  };

  return (
    <main className="min-h-screen bg-[#07131d] text-slate-100" dir="rtl">
      <header className="flex min-h-16 items-center justify-between border-b border-white/10 bg-[#0a1b29] px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-400 text-[#04231f] shadow-lg shadow-teal-400/15">
            <Layers3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">استوديو الإسناد الجغرافي</h1>
            <p className="text-xs text-slate-400">هندسة دقيقة فوق خرائط Google</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs text-slate-300 md:flex">
          <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-teal-200">الموقع: {formatCoordinates(mapSnapshot.lat, mapSnapshot.lng)}</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">تكبير {mapSnapshot.zoom}</span>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="order-2 border-t border-white/10 bg-[#0a1b29] p-4 lg:order-1 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">أدوات المشروع</h2>
            <Badge className="border-0 bg-teal-300/10 text-teal-200 hover:bg-teal-300/10">{MODE_LABEL[currentMode]}</Badge>
          </div>

          <div className="space-y-3">
            <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/svg+xml,.svg" className="hidden" onChange={handleUpload} />
            <Button className="h-11 w-full justify-between bg-teal-400 text-[#05251f] hover:bg-teal-300" onClick={() => inputRef.current?.click()}>
              <span className="flex items-center gap-2"><FileUp className="h-4 w-4" />رفع مخطط PDF</span>
              <span className="text-[10px] font-medium">PDF / SVG / PNG</span>
            </Button>
            <p className="min-h-5 truncate text-xs text-slate-400">{fileName || "لم يتم اختيار ملف بعد"}</p>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white" onClick={() => setMapLocked(value => !value)}>
                {mapLocked ? <Lock className="ml-2 h-4 w-4 text-amber-300" /> : <Unlock className="ml-2 h-4 w-4" />}
                {mapLocked ? "فتح الخريطة" : "قفل الخريطة"}
              </Button>
              <Button variant="outline" disabled={!overlayImage} className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white disabled:text-slate-600" onClick={() => setOverlayLocked(value => !value)}>
                {overlayLocked ? <LockKeyhole className="ml-2 h-4 w-4 text-amber-300" /> : <Move className="ml-2 h-4 w-4" />}
                {overlayLocked ? "فتح المخطط" : "قفل المخطط"}
              </Button>
            </div>

            <Button variant="outline" className="w-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white" onClick={() => setRoadsVisible(value => !value)}>
              {roadsVisible ? <EyeOff className="ml-2 h-4 w-4 text-teal-200" /> : <Eye className="ml-2 h-4 w-4 text-teal-200" />}
              <Route className="ml-2 h-4 w-4" />
              {roadsVisible ? "إخفاء تخطيط الطرق" : "إظهار تخطيط الطرق"}
            </Button>

            <Button variant="outline" disabled={!overlayImage} className="w-full border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:text-white" onClick={centreOverlay}>
              <Focus className="ml-2 h-4 w-4" />توسيط المخطط فوق الخريطة
            </Button>
          </div>

          <div className="my-5 h-px bg-white/10" />

          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">حفظ الإسناد</h3><Save className="h-4 w-4 text-teal-300" /></div>
            <p className="text-xs leading-5 text-slate-400">يحفظ الموضع والدوران والمقياس ومركز الخريطة وملف الطبقة على هذا الجهاز.</p>
            <Button disabled={!overlayImage} className="w-full bg-slate-100 text-slate-950 hover:bg-white" onClick={() => void saveSession()}>
              <Save className="ml-2 h-4 w-4" />حفظ الحالة
            </Button>
          </div>

          <div className="my-5 h-px bg-white/10" />

          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">نطاق التصدير</h3><ScanLine className="h-4 w-4 text-orange-300" /></div>
            <Button variant="outline" className="w-full border-orange-300/25 bg-orange-300/10 text-orange-100 hover:bg-orange-300/15 hover:text-orange-50" onClick={toggleExportMode}>
              {isExporting ? <Check className="ml-2 h-4 w-4" /> : <Crosshair className="ml-2 h-4 w-4" />}
              {isExporting ? "إخفاء إطار التصدير" : "تحديد نطاق التصدير"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={!exportBounds} className="bg-orange-400 text-[#321400] hover:bg-orange-300" onClick={() => void exportResult("png")}><Download className="ml-2 h-4 w-4" />PNG</Button>
              <Button disabled={!exportBounds} className="bg-orange-400 text-[#321400] hover:bg-orange-300" onClick={() => void exportResult("pdf")}><Download className="ml-2 h-4 w-4" />PDF</Button>
            </div>
          </div>
        </aside>

        <section className="relative order-1 min-h-[62vh] overflow-hidden bg-slate-800 lg:order-2 lg:min-h-0" ref={captureRef}>
          <MapView initialCenter={{ lat: INITIAL_MAP.lat, lng: INITIAL_MAP.lng }} initialZoom={INITIAL_MAP.zoom} className="absolute inset-0 h-full w-full" onMapReady={handleMapReady} />
          <GeoOverlay map={map} imageUrl={overlayImage} transform={transform} locked={overlayLocked || isExporting} opacity={overlayOpacity / 100} onTransformChange={setTransform} />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-[#07131d]/85 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-teal-300" />
              {isExporting ? "وضع التصدير: عدّل الإطار البرتقالي ثم اختر الصيغة" : mapLocked ? "الخريطة مقفلة: لا يمكن تحريكها أو تكبيرها" : overlayImage && !overlayLocked ? "المخطط قابل للسحب: ضع الطبقة تقريبياً ثم استخدم الضبط الدقيق" : "تنقل بالخريطة أو ارفع مخططاً للبدء"}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden max-w-xs rounded-xl border border-white/10 bg-[#07131d]/85 p-3 text-xs leading-5 text-slate-300 shadow-xl backdrop-blur md:block">
            <div className="mb-1 flex items-center gap-2 text-slate-100"><MapIcon className="h-3.5 w-3.5 text-teal-300" />تسلسل العمل</div>
            تنقل للموقع، اقفل الخريطة، ارفع المخطط، اسحبه للموقع، اضبطه بدقة، ثم حدّد نطاق التصدير.
          </div>
        </section>

        <aside className="order-3 border-t border-white/10 bg-[#0a1b29] p-4 lg:border-r lg:border-t-0">
          <Card className="border-white/10 bg-white/[0.04] text-slate-100 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="flex items-center justify-between text-sm"><span>التحكم الدقيق</span><MousePointer2 className="h-4 w-4 text-teal-300" /></CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400"><Label className="text-xs text-slate-400">شفافية المخطط</Label><span className="font-mono text-teal-200">{overlayOpacity}%</span></div>
                <Slider value={[overlayOpacity]} onValueChange={value => setOverlayOpacity(value[0] ?? 72)} min={10} max={100} step={1} disabled={!overlayImage} />
                <p className="mt-2 text-[11px] leading-4 text-slate-500">يبقى التحكم متاحاً أثناء السحب والقفل والضبط الدقيق.</p>
              </div>

              <div className="h-px bg-white/10" />

              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400"><Label className="text-xs text-slate-400">سرعة الحساسية</Label><span className="font-mono text-teal-200">{precision}</span></div>
                <Slider value={[precision]} onValueChange={value => setPrecision(value[0] ?? 2)} min={1} max={10} step={1} disabled={!overlayImage} />
                <p className="mt-2 text-[11px] leading-4 text-slate-500">الحركة: {(precision * 0.00001).toFixed(5)}° · الدوران: {(precision * 0.25).toFixed(2)}°</p>
              </div>

              <div className="grid grid-cols-3 gap-2" dir="ltr">
                <div />
                <PrecisionButton label="أعلى" icon={<ArrowUp />} onClick={() => applyPrecision("north")} disabled={!overlayImage} />
                <div />
                <PrecisionButton label="يسار" icon={<ArrowLeft />} onClick={() => applyPrecision("west")} disabled={!overlayImage} />
                <div className="grid place-items-center rounded-lg border border-white/10 bg-white/[0.03]"><Crosshair className="h-5 w-5 text-teal-300/70" /></div>
                <PrecisionButton label="يمين" icon={<ArrowRight />} onClick={() => applyPrecision("east")} disabled={!overlayImage} />
                <div />
                <PrecisionButton label="أسفل" icon={<ArrowDown />} onClick={() => applyPrecision("south")} disabled={!overlayImage} />
                <div />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PrecisionButton label="تدوير عكسي" icon={<RotateCcw />} onClick={() => applyPrecision("rotateCounterClockwise")} disabled={!overlayImage} />
                <PrecisionButton label="تدوير مع" icon={<RotateCw />} onClick={() => applyPrecision("rotateClockwise")} disabled={!overlayImage} />
                <PrecisionButton label="تصغير" icon={<ZoomOut />} onClick={() => applyPrecision("zoomOut")} disabled={!overlayImage} />
                <PrecisionButton label="تكبير" icon={<ZoomIn />} onClick={() => applyPrecision("zoomIn")} disabled={!overlayImage} />
              </div>

              <div className="rounded-lg border border-white/10 bg-[#06111a] p-3 font-mono text-[11px] leading-5 text-slate-400">
                <div className="flex justify-between"><span>الموضع</span><span className="text-slate-200">{formatCoordinates(transform.lat, transform.lng)}</span></div>
                <div className="flex justify-between"><span>الدوران</span><span className="text-slate-200">{transform.rotation.toFixed(2)}°</span></div>
                <div className="flex justify-between"><span>المقياس</span><span className="text-slate-200">{transform.spanLng.toFixed(6)}°</span></div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function PrecisionButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button disabled={disabled} variant="outline" className="h-10 border-white/10 bg-white/[0.04] text-slate-200 hover:bg-teal-300/15 hover:text-teal-50 disabled:text-slate-600" onClick={onClick} aria-label={label}>
          <span className="h-4 w-4">{icon}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
