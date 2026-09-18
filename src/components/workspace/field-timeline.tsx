"use client";

/**
 * "Throughout the years" for one field.
 *
 * The default view stays the farm's own saved aerial; Sentinel-2 only engages once the admin
 * scrubs, so opening the map costs nothing. Analysis lines observed change up against this farm's
 * activity logs, and always renders the readings beside the claim: the chart is the evidence, and
 * an observation is never presented as a verdict about a person.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FarmMapPicker } from "@/components/accounts/farm-map-picker";
import { Loader2, Sparkles } from "lucide-react";
import { LAYERS, type FieldAnalysisResult, type FieldTimelineDto, type Layer } from "@/contracts/satellite";
import { accountRequest } from "@/lib/account-client";
import { NdviChart, NdviTable } from "./ndvi-chart";
import { Badge, Button, EmptyState, Modal } from "./workspace-ui";
import s from "./field-timeline.module.css";

type Field = { id: string; name: string; boundary?: Array<{ x: number; y: number }> };

const LAYER_LABELS: Record<Layer, string> = { "true-colour": "True colour", infrared: "Infrared", ndvi: "NDVI" };

const EXTENT_NOTE: Record<NonNullable<FieldTimelineDto["extent"]>["source"], string | null> = {
  capture: null,
  located: "This farm's location was placed by hand, so field outlines may sit slightly off the satellite image.",
  placeholder: "Sample farm: these coordinates are a stand-in, so the imagery below is real land but not this farm's.",
};

const monthLabel = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const addMonths = (month: string, delta: number) => {
  const [year, index] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastDayOf = (month: string) => {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
};

const CONFIDENCE: Record<string, { label: string; tone: "green" | "amber" }> = {
  clear: { label: "Clear pattern", tone: "green" },
  possible: { label: "Possible", tone: "amber" },
  "insufficient-data": { label: "Not enough clear imagery", tone: "amber" },
};

export function FieldTimeline({ field, fields }: { field: Field; fields: Field[] }) {
  const [timeline, setTimeline] = useState<FieldTimelineDto | null>(null);
  const [error, setError] = useState("");
  const [monthIndex, setMonthIndex] = useState(0);
  const [passIndex, setPassIndex] = useState(0);
  const [layer, setLayer] = useState<Layer>("true-colour");
  const [engaged, setEngaged] = useState(false);
  const [analysis, setAnalysis] = useState<FieldAnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [placing, setPlacing] = useState(false);

  const load = useCallback(async (month?: string) => {
    const params = new URLSearchParams({ field: field.id });
    if (month) params.set("month", month);
    const body = await accountRequest<{ data: FieldTimelineDto }>(`/api/fields/timeline?${params}`);
    return body.data;
  }, [field.id]);

  useEffect(() => {
    let live = true;
    setTimeline(null); setError(""); setEngaged(false); setAnalysis(null); setPassIndex(0);
    load().then(data => {
      if (!live) return;
      setTimeline(data);
      setMonthIndex(Math.max(0, data.months.length - 1));
      const latest = data.months.at(-1)?.month;
      if (latest) setRange({ from: `${addMonths(latest, -2)}-01`, to: lastDayOf(latest) });
    }).catch((cause: Error) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [field.id, load]);

  const months = timeline?.months ?? [];
  const month = months[monthIndex];
  const passes = timeline?.acquisitions ?? [];
  const pass = passes[Math.min(passIndex, Math.max(0, passes.length - 1))] ?? (month ? { date: month.date, cloudCover: month.cloudCover } : null);

  async function scrubTo(index: number) {
    setEngaged(true);
    setMonthIndex(index);
    setPassIndex(0);
    const target = months[index]?.month;
    if (!target || !timeline) return;
    try {
      const data = await load(target);
      setTimeline(previous => previous && { ...previous, acquisitions: data.acquisitions });
    } catch (cause) { setError((cause as Error).message); }
  }

  async function analyse() {
    if (!range) return;
    setAnalysing(true); setError(""); setAnalysis(null);
    try {
      const body = await accountRequest<{ data: FieldAnalysisResult }>("/api/fields/analysis", {
        method: "POST",
        body: JSON.stringify({ fieldId: field.id, from: range.from, to: range.to }),
      });
      setAnalysis(body.data);
    } catch (cause) { setError((cause as Error).message); }
    finally { setAnalysing(false); }
  }

  if (error && !timeline) return <div className={s.panelBody}><EmptyState title="The timeline isn’t available" description={error} /></div>;
  if (!timeline) return <div className={s.panelBody}><p className={s.loading}><Loader2 className={s.spinner} size={16} /> Looking for satellite passes over this farm…</p></div>;

  if (!timeline.extent) {
    return <div className={s.panelBody}>
      <EmptyState title="This farm has no location yet"
        description="Satellite history needs to know where your fields are. Place your saved map on the world and the timeline appears here." />
      <button type="button" className={s.setupLink} onClick={() => setPlacing(true)}>Place this farm on the map</button>
      {placing && <Modal wide title="Where is this farm?" onClose={() => setPlacing(false)}>
        <FarmMapPicker disabled={false} onCapture={() => {}} onUpload={() => {}}
          overlay={fields.filter(item => item.boundary?.length).map(item => ({ id: item.id, boundary: item.boundary! }))}
          onLocate={async bbox => {
            await accountRequest("/api/farm/location", { method: "POST", body: JSON.stringify({ bbox }) });
            setPlacing(false);
            setTimeline(await load());
          }} />
      </Modal>}
    </div>;
  }

  if (!months.length) {
    return <div className={s.panelBody}>
      <EmptyState title="No clear satellite passes" description="Sentinel-2 has no sufficiently cloud-free imagery of this farm yet." />
    </div>;
  }

  const note = EXTENT_NOTE[timeline.extent.source];
  const logsThisMonth = timeline.logDates.filter(log => month && log.date.startsWith(month.month));
  const frameSrc = pass ? `/api/fields/imagery?date=${pass.date}&layer=${layer}` : "";

  return <div className={s.timeline}>
    <div className={s.frame}>
      {engaged && frameSrc
        ? <img className={s.frameImage} src={frameSrc} alt={`Sentinel-2 ${LAYER_LABELS[layer]} view of this farm on ${pass ? dayLabel(pass.date) : ""}`} />
        : <div className={s.framePrompt}>Drag the slider to see this farm from orbit.</div>}
      {engaged && <svg className={s.outlines} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {fields.filter(item => item.boundary?.length).map(item => <polygon key={item.id}
          className={item.id === field.id ? s.outlineSelected : s.outline}
          points={item.boundary!.map(point => `${point.x},${point.y}`).join(" ")} vectorEffect="non-scaling-stroke" />)}
      </svg>}
    </div>

    <div className={s.controls}>
      <div className={s.layers} role="group" aria-label="Map layer">
        {LAYERS.map(option => <button key={option} type="button" className={option === layer ? s.layerActive : s.layerButton}
          aria-pressed={option === layer} onClick={() => { setLayer(option); setEngaged(true); }}>{LAYER_LABELS[option]}</button>)}
      </div>
      <div className={s.scrubHeader}>
        <strong>{month ? monthLabel(month.month) : ""}</strong>
        {pass && <span className={s.scrubMeta}>{dayLabel(pass.date)} · {Math.round(pass.cloudCover)}% cloud</span>}
      </div>
      <input className={s.scrubber} type="range" min={0} max={months.length - 1} value={monthIndex}
        aria-label="Month" aria-valuetext={month ? monthLabel(month.month) : undefined}
        onChange={event => void scrubTo(Number(event.target.value))} />
      <div className={s.scrubEnds}><span>{monthLabel(months[0].month)}</span><span>{monthLabel(months[months.length - 1].month)}</span></div>

      {passes.length > 1 && <div className={s.passes} role="group" aria-label="Passes this month">
        {passes.map((item, index) => <button key={item.date} type="button" className={index === passIndex ? s.passActive : s.passButton}
          aria-pressed={index === passIndex} onClick={() => { setPassIndex(index); setEngaged(true); }}>
          {new Date(`${item.date}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })}
        </button>)}
      </div>}

      {logsThisMonth.length > 0 && <p className={s.monthLogs}>
        {logsThisMonth.length} activity log{logsThisMonth.length === 1 ? "" : "s"} on {field.name} this month
      </p>}
      {note && <p className={s.note}>{note}</p>}
    </div>

    <div className={s.analysis}>
      <div className={s.analysisHeader}>
        <div>
          <h3>Compare with activity logs</h3>
          <p>Toph reads the cloud-free vegetation readings for {field.name} and the work recorded on it.</p>
        </div>
        <Sparkles size={18} color="#888" />
      </div>
      {range && <div className={s.rangeRow}>
        <label>From<input type="date" value={range.from} max={range.to} onChange={event => setRange({ ...range, from: event.target.value })} /></label>
        <label>To<input type="date" value={range.to} min={range.from} onChange={event => setRange({ ...range, to: event.target.value })} /></label>
        <Button disabled={analysing} onClick={() => void analyse()}>{analysing ? "Reading…" : "Analyse"}</Button>
      </div>}
      {error && <p className={s.error} role="alert">{error}</p>}

      {analysis && <div className={s.result}>
        <p className={s.summary}>{analysis.summary}</p>
        <NdviChart series={analysis.series} logs={timeline.logDates} />
        {analysis.observations.map((observation, index) => {
          const confidence = CONFIDENCE[observation.confidence] ?? CONFIDENCE.possible;
          return <div key={`${observation.fromDate}-${index}`} className={s.observation}>
            <div className={s.observationHead}>
              <Badge tone={confidence.tone}>{confidence.label}</Badge>
              {observation.confidence !== "insufficient-data" && <span className={s.change}>
                {observation.indexChange > 0 ? "+" : ""}{observation.indexChange.toFixed(2)} NDVI
              </span>}
            </div>
            <p>{observation.claim}</p>
            {observation.logId && <Link className={s.observationLog} href={`/activity-logs?log=${observation.logId}`}>Open the log this refers to</Link>}
          </div>;
        })}
        <NdviTable series={analysis.series} />
        <p className={s.caveat}>
          Satellite readings describe the ground, not a person’s work. Crop stage, weather, the product used and
          thin cloud all change these numbers, so a flat line is never evidence that work was not done.
        </p>
      </div>}
    </div>
  </div>;
}
