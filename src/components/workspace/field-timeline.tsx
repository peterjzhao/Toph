"use client";

/**
 * Satellite history for the Map page's one map.
 *
 * The slider's last stop is today, which shows the farm's own saved aerial. Every other stop is a
 * real, mostly cloud-free Sentinel-2 pass, drawn over the same box so the field outlines stay where
 * they are. The pass list is fetched once per visit and the slider and date picker move without
 * asking the server anything. Only the pass they settle on is rendered, and the image on screen
 * stays up until the next one has loaded.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { FarmMapPicker } from "@/components/accounts/farm-map-picker";
import type { FieldTimelineDto } from "@/contracts/satellite";
import { accountRequest } from "@/lib/account-client";
import { passIndexForDate } from "@/lib/satellite-passes";
import { Modal } from "./workspace-ui";
import s from "./field-timeline.module.css";

type Field = { id: string; boundary?: Array<{ x: number; y: number }> };

/** Long enough that dragging the slider renders only where it stops. */
const SETTLE_MS = 250;

const EXTENT_NOTE: Record<NonNullable<FieldTimelineDto["extent"]>["source"], string | null> = {
  capture: null,
  located: "This farm's location was placed by hand, so field outlines may sit slightly off the satellite image.",
  placeholder: "Sample farm: these coordinates are a stand-in, so this imagery is real land but not this farm's.",
};

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const frameUrl = (date: string) => `/api/fields/imagery?date=${date}&layer=true-colour`;

export function useFieldTimeline() {
  const [timeline, setTimeline] = useState<FieldTimelineDto | null>(null);
  const [error, setError] = useState("");
  /** Slider position; null until the admin moves it, which means today. */
  const [index, setIndex] = useState<number | null>(null);
  /** The date picker's value; it keeps what was picked rather than jumping to the nearest pass. */
  const [picked, setPicked] = useState("");
  const [settled, setSettled] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [frameError, setFrameError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const body = await accountRequest<{ data: FieldTimelineDto }>("/api/fields/timeline");
      setTimeline(body.data);
      setIndex(null);
      setPicked("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const passes = timeline?.passes ?? [];
  const today = timeline?.today ?? "";
  const current = Math.min(index ?? passes.length, passes.length);
  const pass = current < passes.length ? passes[current] : null;
  const passDate = pass?.date ?? null;

  // Dragging fires on every stop it crosses; only the one it rests on is worth rendering.
  useEffect(() => {
    if (!passDate) { setSettled(null); return; }
    const timer = setTimeout(() => setSettled(passDate), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [passDate]);

  // Load the next frame off-screen, and swap it in only once it has arrived.
  useEffect(() => {
    setFrameError("");
    if (!settled) { setShown(null); return; }
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setShown(frameUrl(settled)); };
    image.onerror = () => { if (live) setFrameError(`The image from ${dayLabel(settled)} couldn’t be loaded. Try another date.`); };
    image.src = frameUrl(settled);
    return () => { live = false; };
  }, [settled]);

  const showing = pass && shown === frameUrl(pass.date);

  return {
    timeline, error, passes, today, current, pass, picked, frameError, reload: load,
    loadingFrame: Boolean(pass) && !showing && !frameError,
    /** What the map draws over its aerial: null shows the saved map. */
    overlayUrl: pass ? shown : null,
    overlayAlt: pass ? `Sentinel-2 image of this farm on ${dayLabel(pass.date)}` : "",
    slideTo(next: number) {
      setIndex(next);
      setPicked(next < passes.length ? passes[next].date : "");
    },
    pickDate(date: string) {
      setPicked(date);
      setIndex(passIndexForDate(passes, date, today));
    },
  };
}

export type FieldTimelineState = ReturnType<typeof useFieldTimeline>;

export function FieldTimelineBar({ timeline: state, fields }: { timeline: FieldTimelineState; fields: Field[] }) {
  const [placing, setPlacing] = useState(false);
  const { timeline, passes, today, current, pass } = state;

  if (state.error && !timeline) return <p className={s.error} role="alert">Satellite history isn’t available: {state.error}</p>;
  if (!timeline) return <p className={s.caption}><Loader2 className={s.spinner} size={14} /> Finding satellite passes over this farm…</p>;

  if (!timeline.extent) {
    return <>
      <p className={s.caption}>
        Satellite history needs this farm’s location.
        <button type="button" className={s.link} onClick={() => setPlacing(true)}>Place this farm on the map</button>
      </p>
      {placing && <Modal wide title="Where is this farm?" onClose={() => setPlacing(false)}>
        <FarmMapPicker disabled={false} onCapture={() => {}} onUpload={() => {}}
          overlay={fields.filter(item => item.boundary?.length).map(item => ({ id: item.id, boundary: item.boundary! }))}
          onLocate={async bbox => {
            await accountRequest("/api/farm/location", { method: "POST", body: JSON.stringify({ bbox }) });
            setPlacing(false);
            await state.reload();
          }} />
      </Modal>}
    </>;
  }

  if (!passes.length) return <p className={s.caption}>Sentinel-2 has no clear imagery of this farm yet.</p>;

  const note = pass ? EXTENT_NOTE[timeline.extent.source] : null;
  return <div className={s.bar}>
    <div className={s.row}>
      <input className={s.slider} type="range" min={0} max={passes.length} step={1} value={current}
        aria-label="Satellite date" aria-valuetext={pass ? dayLabel(pass.date) : "Today, saved map"}
        onChange={event => state.slideTo(Number(event.target.value))} />
      <input className={s.date} type="date" aria-label="Pick a date" min={passes[0].date} max={today}
        value={state.picked || today} onChange={event => state.pickDate(event.target.value)} />
    </div>
    <p className={s.caption}>
      {state.loadingFrame && <Loader2 className={s.spinner} size={14} />}
      {pass
        ? <span>Sentinel-2 · {dayLabel(pass.date)} · {Math.round(pass.cloudCover)}% cloud</span>
        : <span>Today · your saved map. Slide back or pick a date to see Sentinel-2 imagery since {new Date(`${passes[0].date}T12:00:00Z`).getUTCFullYear()}.</span>}
    </p>
    {state.frameError && <p className={s.error} role="alert">{state.frameError}</p>}
    {note && <p className={s.note}>{note}</p>}
  </div>;
}
