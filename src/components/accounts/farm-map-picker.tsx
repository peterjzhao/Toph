"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle, LocateFixed, Minus, Plus, Search } from "lucide-react";
import { accountRequest } from "@/lib/account-client";
import styles from "./accounts.module.css";

// USGS imagery is public domain. Cached tiles stop at level 16; closer zooms scale those tiles.
const TILE_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile";
const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 16;
const BACKDROP_LEVELS = 3;
const MIN_ZOOM = 3.5;
const MAX_ZOOM = 18;
const CAPTURE_MIN_ZOOM = 13;
const APPROXIMATE_ZOOM = 11;
const PRECISE_ZOOM = 15.5;
const MAX_GLIDE = 45;
const WEB_MERCATOR_LIMIT = 20_037_508.34;

type View = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type Tile = { key: string; src: string; x: number; y: number; width: number; height: number };
export type CapturedFarmImage = { dataUrl: string; width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const worldPixels = (zoom: number) => TILE_SIZE * 2 ** zoom;
function toView(lat: number, lng: number, zoom: number): View {
  const sin = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
  return { x: (lng + 180) / 360, y: .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI), zoom };
}

/** Tiles for one zoom level, scaled to the fractional view zoom. Edges are rounded together so no seams show. */
function tileLayer(view: View, size: { width: number; height: number }, level: number): Tile[] {
  const drawn = TILE_SIZE * 2 ** (view.zoom - level), count = 2 ** level, world = worldPixels(view.zoom);
  const left = view.x * world - size.width / 2, top = view.y * world - size.height / 2;
  const tiles: Tile[] = [];
  for (let ty = Math.max(0, Math.floor(top / drawn)); ty <= Math.min(count - 1, Math.floor((top + size.height) / drawn)); ty++)
    for (let tx = Math.floor(left / drawn); tx <= Math.floor((left + size.width) / drawn); tx++) {
      const x = Math.round(tx * drawn - left), y = Math.round(ty * drawn - top);
      tiles.push({ key: `${level}/${ty}/${tx}`, src: `${TILE_URL}/${level}/${ty}/${((tx % count) + count) % count}`, x, y, width: Math.round((tx + 1) * drawn - left) - x, height: Math.round((ty + 1) * drawn - top) - y });
    }
  return tiles;
}

export function FarmMapPicker({ disabled, onCapture, onUpload }: { disabled: boolean; onCapture: (image: CapturedFarmImage) => void; onUpload: () => void }) {
  const [view, setView] = useState<View>(() => toView(39.5, -98.35, 4));
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"" | "search" | "locate" | "capture">("");
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const current = useRef(view);
  const touched = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef(0);
  const velocity = useRef({ x: 0, y: 0, at: 0 });
  const zoomTarget = useRef<{ zoom: number; anchor: Point } | null>(null);
  const frame = useRef(0);

  const apply = useCallback((next: View) => {
    current.current = { x: clamp(next.x, 0, 1), y: clamp(next.y, 0, 1), zoom: clamp(next.zoom, MIN_ZOOM, MAX_ZOOM) };
    setView(current.current);
  }, []);
  const panBy = useCallback((dx: number, dy: number) => {
    const world = worldPixels(current.current.zoom);
    apply({ ...current.current, x: current.current.x - dx / world, y: current.current.y - dy / world });
  }, [apply]);
  /** Changes zoom while keeping the map point under `anchor` (viewport pixels) fixed. */
  const zoomAround = useCallback((zoom: number, anchor: Point) => {
    const element = viewport.current;
    if (!element) return;
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM), from = current.current;
    const offsetX = anchor.x - element.clientWidth / 2, offsetY = anchor.y - element.clientHeight / 2;
    apply({ zoom: next, x: from.x + offsetX / worldPixels(from.zoom) - offsetX / worldPixels(next), y: from.y + offsetY / worldPixels(from.zoom) - offsetY / worldPixels(next) });
  }, [apply]);

  // One animation loop eases zoom toward its target and lets a released drag glide to a stop.
  const animate = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const step = () => {
      let moving = false;
      const target = zoomTarget.current;
      if (target) {
        const remaining = target.zoom - current.current.zoom;
        if (Math.abs(remaining) < .004) { zoomAround(target.zoom, target.anchor); zoomTarget.current = null; }
        else { zoomAround(current.current.zoom + remaining * .22, target.anchor); moving = true; }
      }
      const glide = velocity.current;
      if (!pointers.current.size && Math.hypot(glide.x, glide.y) > .4) {
        panBy(glide.x, glide.y);
        velocity.current = { ...glide, x: glide.x * .92, y: glide.y * .92 };
        moving = true;
      }
      if (moving) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [panBy, zoomAround]);
  const zoomToward = useCallback((zoom: number, anchor?: Point) => {
    const element = viewport.current;
    if (!element) return;
    touched.current = true;
    zoomTarget.current = { zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), anchor: anchor ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 } };
    animate();
  }, [animate]);
  const jumpTo = useCallback((lat: number, lng: number, zoom: number) => {
    zoomTarget.current = null; velocity.current = { x: 0, y: 0, at: 0 };
    apply(toView(lat, lng, zoom));
  }, [apply]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    // React registers wheel listeners as passive, which can't stop the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      const change = clamp(-pixels * (event.ctrlKey ? .012 : .0035), -.6, .6);
      zoomToward((zoomTarget.current?.zoom ?? current.current.zoom) + change, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener("wheel", onWheel); cancelAnimationFrame(frame.current); };
  }, [zoomToward]);

  // Start near the farmer: the network's approximate location first, then the device's if already allowed.
  useEffect(() => {
    let alive = true;
    void accountRequest<{ data: { lat: number; lng: number } | null }>("/api/farm/locate").then(found => {
      if (alive && found.data && !touched.current) jumpTo(found.data.lat, found.data.lng, APPROXIMATE_ZOOM);
    }).catch(() => {});
    void navigator.permissions?.query({ name: "geolocation" }).then(status => {
      if (status.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(position => {
        if (alive && !touched.current) { touched.current = true; jumpTo(position.coords.latitude, position.coords.longitude, PRECISE_ZOOM); }
      }, () => {}, { timeout: 10_000 });
    }).catch(() => {});
    return () => { alive = false; };
  }, [jumpTo]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    touched.current = true; pinch.current = 0; zoomTarget.current = null; velocity.current = { x: 0, y: 0, at: event.timeStamp };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const bounds = event.currentTarget.getBoundingClientRect();
      if (pinch.current && distance) zoomAround(current.current.zoom + Math.log2(distance / pinch.current), { x: (first.x + second.x) / 2 - bounds.left, y: (first.y + second.y) / 2 - bounds.top });
      pinch.current = distance;
      return;
    }
    const dx = point.x - previous.x, dy = point.y - previous.y;
    panBy(dx, dy);
    const elapsed = Math.max(8, event.timeStamp - velocity.current.at);
    // Per-frame velocity, smoothed and capped so one jittery sample doesn't fling the map.
    const glide = (before: number, moved: number) => clamp(before * .5 + moved / elapsed * 16 * .5, -MAX_GLIDE, MAX_GLIDE);
    velocity.current = { x: glide(velocity.current.x, dx), y: glide(velocity.current.y, dy), at: event.timeStamp };
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    pinch.current = 0;
    if (pointers.current.size || event.timeStamp - velocity.current.at > 80) velocity.current = { x: 0, y: 0, at: 0 };
    else animate();
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setBusy("search"); setError("");
    try {
      const found = await accountRequest<{ data: { lat: number; lng: number } }>(`/api/farm/geocode?q=${encodeURIComponent(query.trim())}`);
      touched.current = true; jumpTo(found.data.lat, found.data.lng, PRECISE_ZOOM);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t find that place."); }
    finally { setBusy(""); }
  }
  function locate() {
    if (busy) return;
    if (!navigator.geolocation) { setError("Location isn’t available in this browser. Search for your farm instead."); return; }
    setBusy("locate"); setError("");
    navigator.geolocation.getCurrentPosition(
      position => { touched.current = true; jumpTo(position.coords.latitude, position.coords.longitude, PRECISE_ZOOM); setBusy(""); },
      cause => { setError(cause.code === cause.PERMISSION_DENIED ? "Location access is blocked for this site. Allow it in your browser, or search for your farm." : "We couldn’t read your location. Search for your farm instead."); setBusy(""); },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }
  async function capture() {
    if (busy || !size.width) return;
    setBusy("capture"); setError("");
    const world = worldPixels(view.zoom), halfX = size.width / 2 / world, halfY = size.height / 2 / world;
    const meters = (value: number) => Math.round((value - .5) * 2 * WEB_MERCATOR_LIMIT * 100) / 100;
    const bbox = [meters(view.x - halfX), -meters(view.y + halfY), meters(view.x + halfX), -meters(view.y - halfY)];
    try {
      const captured = await accountRequest<{ data: CapturedFarmImage }>(`/api/farm/imagery?bbox=${bbox.join(",")}`);
      onCapture(captured.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t capture this view."); setBusy(""); }
  }

  const level = clamp(Math.round(view.zoom), 0, MAX_TILE_ZOOM);
  // A coarse layer underneath keeps the map filled while sharper tiles load.
  const tiles = size.width ? [...(level > BACKDROP_LEVELS ? tileLayer(view, size, level - BACKDROP_LEVELS) : []), ...tileLayer(view, size, level)] : [];
  const canCapture = view.zoom >= CAPTURE_MIN_ZOOM;

  return <div className={styles.picker}>
    <form className={styles.pickerSearch} onSubmit={event => void search(event)} role="search">
      <Search size={16} aria-hidden />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your farm" aria-label="Search your farm by address or coordinates" disabled={disabled} />
      <button className={styles.secondaryButton} type="submit" disabled={disabled || Boolean(busy) || !query.trim()}>{busy === "search" ? <LoaderCircle className={styles.spinner} size={16} /> : "Find"}</button>
    </form>
    <div ref={viewport} className={styles.pickerMap} role="application" aria-label="Satellite map. Drag to move, scroll or pinch to zoom." tabIndex={0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
      onDoubleClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); zoomToward(current.current.zoom + 1, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }); }}
      onKeyDown={event => {
        const step = 80;
        if (event.key === "ArrowLeft") panBy(step, 0); else if (event.key === "ArrowRight") panBy(-step, 0);
        else if (event.key === "ArrowUp") panBy(0, step); else if (event.key === "ArrowDown") panBy(0, -step);
        else if (event.key === "+" || event.key === "=") zoomToward(current.current.zoom + 1); else if (event.key === "-") zoomToward(current.current.zoom - 1);
        else return;
        event.preventDefault();
      }}>
      {tiles.map(tile => <img key={tile.key} src={tile.src} alt="" draggable={false} style={{ width: tile.width, height: tile.height, transform: `translate(${tile.x}px, ${tile.y}px)` }} />)}
      <div className={styles.pickerControls} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <button type="button" aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomToward((zoomTarget.current?.zoom ?? current.current.zoom) + 1)}><Plus size={17} /></button>
        <button type="button" aria-label="Zoom out" disabled={view.zoom <= MIN_ZOOM} onClick={() => zoomToward((zoomTarget.current?.zoom ?? current.current.zoom) - 1)}><Minus size={17} /></button>
      </div>
      <button className={styles.pickerLocate} type="button" disabled={disabled || Boolean(busy)} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={locate}>
        {busy === "locate" ? <LoaderCircle className={styles.spinner} size={15} /> : <LocateFixed size={15} />}My current location
      </button>
      {busy === "capture" && <div className={styles.pickerBusy} role="status"><LoaderCircle className={styles.spinner} size={22} />Capturing this view…</div>}
      <span className={styles.pickerCredit}>Imagery: USGS</span>
    </div>
    <div className={styles.pickerFooter}>
      <p>{canCapture && "Frame your whole farm in the map, then use this view. It becomes your farm image."}</p>
      <div>
        <button className={styles.textButton} type="button" disabled={disabled || Boolean(busy)} onClick={onUpload}>Upload my own image instead</button>
        <button className={styles.primaryButton} type="button" disabled={disabled || Boolean(busy) || !canCapture} onClick={() => void capture()}>Use this view</button>
      </div>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
