"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Crosshair, LoaderCircle, Minus, Plus, Search } from "lucide-react";
import { accountRequest } from "@/lib/account-client";
import styles from "./accounts.module.css";

// USGS imagery is public domain. Cached tiles stop at level 16; closer zooms scale those tiles.
const TILE_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile";
const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 16;
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;
const CAPTURE_MIN_ZOOM = 13;
const WEB_MERCATOR_LIMIT = 20_037_508.34;

type Center = { x: number; y: number };
export type CapturedFarmImage = { dataUrl: string; width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function toCenter(lat: number, lng: number): Center {
  const sin = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
  return { x: (lng + 180) / 360, y: .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}

export function FarmMapPicker({ disabled, onCapture, onUpload }: { disabled: boolean; onCapture: (image: CapturedFarmImage) => void; onUpload: () => void }) {
  const [center, setCenter] = useState<Center>(() => toCenter(39.5, -98.35));
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"" | "search" | "capture">("");
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const wheelAt = useRef(0);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const worldPixels = TILE_SIZE * 2 ** zoom;
  function panBy(dx: number, dy: number) {
    setCenter(previous => ({ x: clamp(previous.x - dx / worldPixels, 0, 1), y: clamp(previous.y - dy / worldPixels, 0, 1) }));
  }
  function zoomTo(next: number, anchor?: { x: number; y: number }) {
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (target === zoom) return;
    if (anchor && size.width) {
      // Keep the point under the cursor fixed while the scale changes.
      const offsetX = anchor.x - size.width / 2, offsetY = anchor.y - size.height / 2;
      const nextWorld = TILE_SIZE * 2 ** target;
      setCenter(previous => ({ x: clamp(previous.x + offsetX / worldPixels - offsetX / nextWorld, 0, 1), y: clamp(previous.y + offsetY / worldPixels - offsetY / nextWorld, 0, 1) }));
    }
    setZoom(target);
  }
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // React registers wheel listeners as passive, which can't stop the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (Math.abs(event.deltaY) < 4 || event.timeStamp - wheelAt.current < 140) return;
      wheelAt.current = event.timeStamp;
      const bounds = element.getBoundingClientRect();
      zoomTo(zoom + (event.deltaY < 0 ? 1 : -1), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    panBy(event.clientX - drag.current.x, event.clientY - drag.current.y);
    drag.current = { x: event.clientX, y: event.clientY };
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setBusy("search"); setError("");
    try {
      const found = await accountRequest<{ data: { lat: number; lng: number } }>(`/api/farm/geocode?q=${encodeURIComponent(query.trim())}`);
      setCenter(toCenter(found.data.lat, found.data.lng)); setZoom(15);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t find that place."); }
    finally { setBusy(""); }
  }
  function locate() {
    if (busy || !navigator.geolocation) return;
    setBusy("search"); setError("");
    navigator.geolocation.getCurrentPosition(
      position => { setCenter(toCenter(position.coords.latitude, position.coords.longitude)); setZoom(15); setBusy(""); },
      () => { setError("We couldn’t read your location. Search for your address instead."); setBusy(""); },
      { timeout: 10_000 },
    );
  }
  async function capture() {
    if (busy || !size.width) return;
    setBusy("capture"); setError("");
    const halfX = size.width / 2 / worldPixels, halfY = size.height / 2 / worldPixels;
    const meters = (value: number) => Math.round((value - .5) * 2 * WEB_MERCATOR_LIMIT * 100) / 100;
    const bbox = [meters(center.x - halfX), -meters(center.y + halfY), meters(center.x + halfX), -meters(center.y - halfY)];
    try {
      const captured = await accountRequest<{ data: CapturedFarmImage }>(`/api/farm/imagery?bbox=${bbox.join(",")}`);
      onCapture(captured.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t capture this view."); setBusy(""); }
  }

  const tileZoom = Math.min(zoom, MAX_TILE_ZOOM);
  const tileScale = 2 ** (zoom - tileZoom);
  const drawn = TILE_SIZE * tileScale;
  const tileCount = 2 ** tileZoom;
  const left = center.x * worldPixels - size.width / 2, top = center.y * worldPixels - size.height / 2;
  const tiles: { key: string; src: string; x: number; y: number }[] = [];
  if (size.width) for (let ty = Math.max(0, Math.floor(top / drawn)); ty <= Math.min(tileCount - 1, Math.floor((top + size.height) / drawn)); ty++)
    for (let tx = Math.floor(left / drawn); tx <= Math.floor((left + size.width) / drawn); tx++) {
      const wrapped = ((tx % tileCount) + tileCount) % tileCount;
      tiles.push({ key: `${tileZoom}/${ty}/${tx}`, src: `${TILE_URL}/${tileZoom}/${ty}/${wrapped}`, x: Math.round(tx * drawn - left), y: Math.round(ty * drawn - top) });
    }
  const canCapture = zoom >= CAPTURE_MIN_ZOOM;

  return <div className={styles.picker}>
    <form className={styles.pickerSearch} onSubmit={event => void search(event)} role="search">
      <Search size={16} aria-hidden />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your farm’s address, or paste latitude, longitude" aria-label="Farm address or coordinates" disabled={disabled} />
      <button className={styles.secondaryButton} type="submit" disabled={disabled || Boolean(busy) || !query.trim()}>{busy === "search" ? <LoaderCircle className={styles.spinner} size={16} /> : "Find"}</button>
    </form>
    <div ref={viewport} className={styles.pickerMap} role="application" aria-label="Satellite map. Drag to move, scroll to zoom." tabIndex={0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => {
        const step = 80;
        if (event.key === "ArrowLeft") panBy(step, 0); else if (event.key === "ArrowRight") panBy(-step, 0);
        else if (event.key === "ArrowUp") panBy(0, step); else if (event.key === "ArrowDown") panBy(0, -step);
        else if (event.key === "+" || event.key === "=") zoomTo(zoom + 1); else if (event.key === "-") zoomTo(zoom - 1);
        else return;
        event.preventDefault();
      }}>
      {tiles.map(tile => <img key={tile.key} src={tile.src} alt="" draggable={false} width={drawn} height={drawn} style={{ transform: `translate(${tile.x}px, ${tile.y}px)` }} />)}
      <div className={styles.pickerControls} onPointerDown={event => event.stopPropagation()}>
        <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + 1)}><Plus size={17} /></button>
        <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom - 1)}><Minus size={17} /></button>
        <button type="button" aria-label="Go to my location" onClick={locate}><Crosshair size={16} /></button>
      </div>
      {busy === "capture" && <div className={styles.pickerBusy} role="status"><LoaderCircle className={styles.spinner} size={22} />Capturing this view…</div>}
      <span className={styles.pickerCredit}>Imagery: USGS</span>
    </div>
    <div className={styles.pickerFooter}>
      <p>{canCapture ? "Frame your whole farm in the map, then use this view. It becomes your farm image." : "Search or zoom in until your fields fill the map."}</p>
      <div>
        <button className={styles.textButton} type="button" disabled={disabled || Boolean(busy)} onClick={onUpload}>Upload my own image instead</button>
        <button className={styles.primaryButton} type="button" disabled={disabled || Boolean(busy) || !canCapture} onClick={() => void capture()}>Use this view</button>
      </div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
