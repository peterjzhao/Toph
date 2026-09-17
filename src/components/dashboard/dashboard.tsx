"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays, Check, ChevronDown, Expand, Funnel, ListFilter, Minus, Pause, Play,
  Plus, Search, Square, SquareCheck, Star, X,
} from "lucide-react";
import { formatDate, formatTime } from "@/lib/format";
import type { DashboardData, EmployeeLog } from "./types";
import styles from "./dashboard.module.css";
import filterStyles from "./filters.module.css";
import { FilterSelect } from "./filter-select";
import { AnchoredPopover } from "./anchored-popover";
import { DateFilterPanel } from "./date-filter-panel";
import { dateRange, dateFilterLabel, initialDateFilter, rangeDescription, type DateFilter } from "./date-range";

function DesignIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <img src={`/assets/icons/${name}.svg`} alt="" aria-hidden="true" width={size} height={size} style={{ display: "block", flexShrink: 0 }} />;
}

const navigation: { label: string; items: { name: string; icon: string }[] }[] = [
  { label: "OVERVIEW", items: [{ name: "Dashboard", icon: "chart-line" }, { name: "Activity Logs", icon: "audio-lines" }, { name: "Map", icon: "map" }] },
  { label: "COMPLIANCE", items: [{ name: "Audit Manager", icon: "book-check" }, { name: "Reports", icon: "files" }, { name: "Schedule", icon: "calendar" }] },
  { label: "TEAM MANAGEMENT", items: [{ name: "Employees", icon: "users" }, { name: "Performance", icon: "chart-pie" }, { name: "Messages", icon: "mail" }] },
  { label: "OTHER", items: [{ name: "Settings", icon: "cog" }, { name: "Support", icon: "handshake" }] },
];

type SortOrder = "date-asc" | "date-desc" | "employee" | "activity" | "none";
const sortOptions: { value: SortOrder; label: string }[] = [
  { value: "date-asc", label: "Date: oldest first" },
  { value: "date-desc", label: "Date: newest first" },
  { value: "employee", label: "Employee: A to Z" },
  { value: "activity", label: "Activity: A to Z" },
];

function SelectionBox({ label, checked, onChange, mixed = false }: { label: string; checked: boolean; onChange: () => void; mixed?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <label className={`${styles.checkbox} ${checked || mixed ? styles.checked : ""}`} onClick={(event) => event.stopPropagation()}>
    <input ref={input} type="checkbox" aria-label={label} checked={checked} onChange={onChange} />
    {checked ? <SquareCheck size={16} /> : <Square size={16} />}
    {mixed && <Minus size={10} className={styles.mixedMark} />}
  </label>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className={styles.dialogInner}>
      <div className={styles.dialogHeader}><h2>{title}</h2><button type="button" className={styles.iconButton} aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      {children}
    </div>
  </dialog>;
}

function MapDialog({ log, onClose }: { log: EmployeeLog; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return <Modal title={log.field.name} onClose={onClose} wide>
    <div className={styles.largeMapViewport}><img className={styles.largeMap} src={log.field.mapImageUrl} alt={`Satellite view of ${log.field.name} with the recorded work location marked`} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} /></div>
    <div className={styles.mapFooter}><span>{log.employee.name} · {formatDate(log.date)}</span><div className={styles.zoomControls}>
      <button type="button" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(Math.max(1, zoom - .5))}><Minus size={16} /></button>
      <button type="button" aria-label="Reset map zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" disabled={zoom === 3} onClick={() => setZoom(Math.min(3, zoom + .5))}><Plus size={16} /></button>
    </div></div>
  </Modal>;
}

function LogDetails({ log, tags, onAddTag, onRemoveTag, onExpandMap, onNotify }: { log: EmployeeLog; tags: string[]; onAddTag: () => void; onRemoveTag?: (label: string) => Promise<void>; onExpandMap: () => void; onNotify: (text: string) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const clips = log.recording.clips;
  const recordingUrl = clips?.[clipIndex]?.url ?? log.recording.url;
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const [progress, setProgress] = useState(55.7444);
  useEffect(() => { const element = audio.current; return () => element?.pause(); }, []);
  async function togglePlayback() {
    const element = audio.current;
    if (!element) return;
    if (playing) element.pause();
    else {
      try { await element.play(); }
      catch { onNotify("The recording could not be played. Please try again."); }
    }
  }
  return <div className={styles.detailLayout} id={`details-${log.id}`}>
    <div className={styles.detailLeft}>
      {log.recording.url ? <div className={styles.waveform} role="img" aria-label="Recording waveform">
        <img src="/assets/waveform.svg" alt="" className={styles.waveformBase} />
        <img src="/assets/waveform.svg" alt="" className={styles.waveformPlayed} style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} />
        <span className={styles.playhead} style={{ left: `${progress}%` }} />
      </div> : <div className={styles.noRecording}>No audio recording is attached to this log.</div>}
      <audio ref={audio} src={recordingUrl || undefined} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0); }} onTimeUpdate={() => { const element = audio.current; if (element && element.duration) setProgress(element.currentTime / element.duration * 100); }} />
      {clips && clips.length > 1 && <div className={styles.recordingActions} aria-label="Recording clips">{clips.map((clip, index) => <button type="button" key={clip.url} className={styles.detailButton} aria-pressed={clipIndex === index} onClick={() => { audio.current?.pause(); setPlaying(false); setClipIndex(index); setProgress(0); }}>Recording {index + 1}</button>)}</div>}
      <div className={styles.recordingActions}>
        <button type="button" className={styles.detailButton} disabled={!log.recording.url} onClick={togglePlayback}>{playing ? <Pause size={16} /> : <Play size={16} />}<span>{!log.recording.url ? "No Recording" : playing ? "Pause Recording" : "Play Recording"}</span></button>
        <button type="button" className={`${styles.detailButton} ${styles.tagButton}`} onClick={onAddTag}><Star size={16} /><span>Add Tag</span></button>
      </div>
      {tags.length > 0 && <div className={styles.tags} aria-label="Log tags">{tags.map(tag => <span key={tag}><Star size={12} />{tag}{onRemoveTag && <button type="button" className={styles.removeTag} disabled={Boolean(removingTag)} aria-label={`Remove tag ${tag}`} onClick={async () => {
        setRemovingTag(tag);
        try { await onRemoveTag(tag); } catch (cause) { onNotify(cause instanceof Error ? cause.message : "The tag could not be removed."); } finally { setRemovingTag(null); }
      }}><X size={12}/></button>}</span>)}</div>}
      <div className={styles.summary}><h3>Summary</h3><p>{log.summary}</p></div>
    </div>
    <div className={styles.detailRight}>
      <>{log.field.mapImageUrl ? <img className={styles.mapPreview} src={log.field.mapImageUrl} alt={`Satellite map of ${log.field.name} showing the work location`} /> : <div className={styles.noRecording}>No map is attached to this log.</div>}</>
      <button type="button" className={styles.detailButton} disabled={!log.field.mapImageUrl} onClick={onExpandMap}><Expand size={16} /><span>Expand Map</span></button>
    </div>
  </div>;
}

export function Dashboard({ data, initialExpandedId = null, embedded = false, activityPage = false, onAddTag, onRemoveTag, onNavigate }: {
  data: DashboardData; initialExpandedId?: string | null; embedded?: boolean; activityPage?: boolean;
  onAddTag?: (logId: string, label: string) => Promise<string[]>;
  onRemoveTag?: (logId: string, label: string) => Promise<string[]>;
  onNavigate?: (path: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(initialExpandedId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("date-asc");
  const today = data.metrics.asOf;
  const [dateFilter, setDateFilter] = useState<DateFilter>(() => initialDateFilter(
    initialExpandedId ? data.logs.filter(log => log.id === initialExpandedId).map(log => log.date) : data.logs.map(log => log.date), today,
  ));
  const [activity, setActivity] = useState("");
  const [field, setField] = useState("");
  const [popover, setPopover] = useState<"sort" | "filter" | "date" | null>(null);
  const [filterDateOpen, setFilterDateOpen] = useState(false);
  const [mapLog, setMapLog] = useState<EmployeeLog | null>(null);
  const [tagLog, setTagLog] = useState<EmployeeLog | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [tags, setTags] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState("");
  const [section, setSection] = useState<string | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const tableBody = useRef<HTMLTableSectionElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const filterDateTrigger = useRef<HTMLButtonElement>(null);
  const filterDatePanel = useRef<HTMLDivElement>(null);
  const logCard = useRef<HTMLElement>(null);
  useEffect(() => { setExpandedId(initialExpandedId); }, [initialExpandedId]);
  useEffect(() => {
    if (!activityPage || !initialExpandedId || expandedId !== initialExpandedId) return;
    // Run after the shared shell resets its scroll position on navigation.
    const frame = requestAnimationFrame(() => document.getElementById(`details-${initialExpandedId}`)?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [activityPage, initialExpandedId, expandedId]);

  useEffect(() => {
    if (!popover) return;
    const trigger = controls.current?.querySelector<HTMLButtonElement>(`[data-popover-trigger="${popover}"]`);
    const firstControl = popover === "sort"
      ? panel.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>("button")
      : popover === "filter" ? panel.current?.querySelector<HTMLElement>('[role="combobox"]')
      : panel.current?.querySelector<HTMLElement>("input") ?? panel.current?.querySelector<HTMLElement>("button");
    // The portal is positioned before it becomes visible; focus on the next frame.
    const focusFrame = requestAnimationFrame(() => firstControl?.focus());
    function dismiss(event: Event) {
      if (!controls.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setPopover(null);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && !event.defaultPrevented) { setPopover(null); trigger?.focus(); } }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("focusin", dismiss); document.removeEventListener("keydown", escape); };
  }, [popover]);

  useEffect(() => {
    if (popover !== "filter") { setFilterDateOpen(false); return; }
    if (!filterDateOpen) return;
    const frame = requestAnimationFrame(() => filterDatePanel.current?.querySelector<HTMLElement>("button")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [popover, filterDateOpen]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timer); }, [notice]);

  const range = useMemo(() => dateRange(dateFilter, today), [dateFilter, today]);
  const latestMonth = data.logs.map(log => log.date.slice(0, 7)).sort().at(-1);
  const historyMonth = latestMonth !== today.slice(0, 7) ? latestMonth : undefined;
  const activityOptions = [...new Set(data.logs.map(log => log.activity))].map(value => ({ value, label: value }));
  const fieldOptions = [...new Map(data.logs.map(log => [log.field.id, { value: log.field.id, label: log.field.name }])).values()];
  function applyDate(value: DateFilter) {
    setDateFilter(value);
    if (popover === "filter") {
      setFilterDateOpen(false);
      filterDateTrigger.current?.focus();
    } else {
      setPopover(null);
      controls.current?.querySelector<HTMLButtonElement>('[data-popover-trigger="date"]')?.focus();
    }
  }

  const logs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = data.logs.filter(log => (!range || (log.date >= range.from && log.date <= range.to)) && (!activity || log.activity === activity) && (!field || log.field.id === field) && (!query || [log.employee.name, log.activity, log.field.name, formatDate(log.date), ...(tags[log.id] ?? log.tags)].join(" ").toLowerCase().includes(query)));
    return filtered.sort((a, b) => {
      if (sort === "date-asc") return a.date.localeCompare(b.date);
      if (sort === "date-desc") return b.date.localeCompare(a.date);
      if (sort === "employee") return a.employee.name.localeCompare(b.employee.name);
      if (sort === "activity") return a.activity.localeCompare(b.activity);
      return 0;
    });
  }, [data.logs, search, activity, field, range, sort, tags]);

  const isExpanded = logs.some(log => log.id === expandedId);
  const newCount = logs.filter(log => log.isNew).length;
  const selectedCount = logs.filter(log => selected.has(log.id)).length;
  const filterCount = Number(Boolean(activity)) + Number(Boolean(field));
  // Preserve the compact Figma view for filtered results; all logs use the page height.
  const hasFilters = Boolean(range || activity || field || search.trim());

  useEffect(() => { if (tableBody.current) tableBody.current.scrollTop = 0; }, [search, activity, field, range, sort]);

  function toggleLog(id: string) {
    setExpandedId(current => current === id ? null : id);
    if (tableBody.current) tableBody.current.scrollTop = 0;
  }
  function toggleSelected(id: string) { setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectAll() { setSelected(current => { const next = new Set(current); const all = logs.every(log => next.has(log.id)); logs.forEach(log => all ? next.delete(log.id) : next.add(log.id)); return next; }); }
  function navigate(name: string) {
    if (name === "Dashboard") { main.current?.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (name === "Activity Logs") { logCard.current?.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (name === "Map") { setMapLog(data.logs.find(log => log.id === expandedId) ?? data.logs[0]); return; }
    setSection(name);
  }
  function resetFilters() { setSearch(""); setActivity(""); setField(""); setDateFilter(initialDateFilter(data.logs.map(log => log.date), today)); setSort("date-asc"); }

  return <div className={embedded ? styles.embedded : styles.app}>
    {!embedded && <><a className={styles.skipLink} href="#dashboard-content">Skip to dashboard</a>
    <aside className={styles.sidebar} aria-label="Farm navigation">
      <div className={styles.profile}>
        <div className={styles.profileIdentity}><div className={styles.avatar}><img src={data.farm.avatarUrl} alt="Bays Ranch administrator" /></div><div className={styles.profileText}><span className={styles.farmName}>{data.farm.name}</span><span className={styles.role}><DesignIcon name="user-star" size={10} /><span>{data.farm.role}</span></span></div></div>
        <button type="button" className={styles.inboxButton} aria-label="Inbox" onClick={() => navigate("Messages")}><DesignIcon name="inbox" /></button>
      </div>
      {navigation.map(group => <nav className={`${styles.navGroup} ${group.label === "OTHER" ? styles.otherGroup : ""}`} key={group.label} aria-label={group.label}>
        <div className={styles.navGroupLabel}>{group.label}</div>
        {group.items.map(({ name, icon }) => <button type="button" className={`${styles.navItem} ${name === "Dashboard" ? styles.activeNav : ""}`} aria-current={name === "Dashboard" ? "page" : undefined} aria-label={name} title={name} key={name} onClick={() => navigate(name)}>
          <DesignIcon name={icon} /><span>{name}</span>{name === "Dashboard" && <span className={styles.navBadge}>1</span>}
        </button>)}
      </nav>)}
      <button type="button" className={styles.navItem} onClick={() => navigate("Switch User")} aria-label="Switch User" title="Switch User"><DesignIcon name="arrow-right-left" /><span>Switch User</span></button>
      <button type="button" className={styles.navItem} onClick={() => navigate("Log Out")} aria-label="Log Out" title="Log Out"><DesignIcon name="log-out" /><span>Log Out</span></button>
    </aside></>}

    <div id={embedded ? undefined : "dashboard-content"} ref={main} className={embedded ? styles.embedded : styles.main}>
      <header className={styles.header}><div><h1>{activityPage ? "Activity Logs" : "Dashboard"}</h1><p>{activityPage ? "Every field activity, recording, and detail in one place" : "An overview of your farm and employee activity"}</p></div><div className={styles.search}><Search size={16} /><input type="search" placeholder="Search" aria-label="Search employee logs" value={search} onChange={event => setSearch(event.target.value)} /></div></header>

      {!activityPage && <section className={styles.metrics} aria-label="Farm activity overview">
        {[{ icon: "recordings", title: "Todays Recordings", value: data.metrics.recordingsToday, note: `${data.metrics.newRecordings} New` }, { icon: "clipboard-pen", title: "Active Workers", value: data.metrics.activeWorkers }, { icon: "percent", title: "Response Accuracy", value: data.metrics.responseAccuracy }].map(({ icon, title, value, note }) => <button type="button" className={styles.metric} key={title} onClick={() => onNavigate?.(title === "Active Workers" ? "/employees" : title === "Response Accuracy" ? "/performance" : "/activity-logs")}><div className={styles.metricTitle}><DesignIcon name={icon} /><span>{title}</span></div><div className={styles.metricValue}><span>{value ?? "—"}</span>{note && <small>{note}</small>}</div></button>)}
      </section>}

      <section ref={logCard} className={`${styles.logCard} ${isExpanded ? styles.expandedCard : ""}`} aria-label="Employee activity logs">
        <div className={styles.toolbar}><h2><DesignIcon name="log-audio" /><span>{activityPage ? "All Employee Logs" : "Employee Logs"} <span className={styles.logCount}>({logs.length})</span></span>{newCount > 0 && <span className={styles.newLogCount}>{newCount} new</span>}</h2>
          <div className={styles.controls} ref={controls}>
            {sort !== "none" && <button type="button" className={`${styles.pill} ${styles.darkPill}`} onClick={() => setSort("none")} aria-label="Remove current sort"><X size={16} /><span>{sort.startsWith("date") ? "Date" : sort === "employee" ? "Employee" : "Activity"}</span></button>}
            <div className={styles.popoverAnchor}><button type="button" className={styles.pill} data-popover-trigger="sort" aria-haspopup="menu" aria-expanded={popover === "sort"} onClick={() => setPopover(popover === "sort" ? null : "sort")}><ListFilter size={16} /><span>Sort</span></button>
              {popover === "sort" && <AnchoredPopover anchor={controls.current?.querySelector('[data-popover-trigger="sort"]') ?? null} panelRef={panel} width={250} className={styles.popover} role="menu" aria-label="Sort logs" onKeyDown={event => {
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
                if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
                if (event.key === "Tab") { setPopover(null); controls.current?.querySelector<HTMLButtonElement>('[data-popover-trigger="sort"]')?.focus(); }
              }}><div className={styles.popoverTitle}>Sort employee logs</div>{sortOptions.map(option => <button type="button" key={option.value} role="menuitemradio" aria-checked={sort === option.value} onClick={() => { setSort(option.value); setPopover(null); controls.current?.querySelector<HTMLButtonElement>('[data-popover-trigger="sort"]')?.focus(); }}><span>{option.label}</span>{sort === option.value && <Check size={15} />}</button>)}</AnchoredPopover>}
            </div>
            <div className={styles.popoverAnchor}>
              <div className={`${styles.pill} ${styles.datePill} ${range ? styles.darkPill : ""} ${dateFilter.kind === "this-month" ? styles.monthPill : ""}`}>
                {range && <button type="button" className={styles.clearDate} aria-label="Clear date filter" onClick={() => applyDate({ kind: "all" })}><X size={16}/></button>}
                <button type="button" data-popover-trigger="date" className={styles.dateTrigger} aria-label={`Date range: ${dateFilterLabel(dateFilter)}`} title={rangeDescription(range)} aria-haspopup="dialog" aria-expanded={popover === "date"} onClick={() => setPopover(popover === "date" ? null : "date")}>
                  {!range && <CalendarDays size={15}/>}<span>{dateFilterLabel(dateFilter)}{range && ` (${logs.length})`}</span>{!range && <ChevronDown size={14}/>}
                </button>
              </div>
              {popover === "date" && <AnchoredPopover anchor={controls.current?.querySelector('[data-popover-trigger="date"]') ?? null} panelRef={panel} width={320} className={filterStyles.panel} role="dialog" aria-label="Choose date range">
                <DateFilterPanel value={dateFilter} today={today} timezone={data.farm.timezone ?? "America/Los_Angeles"} historyMonth={historyMonth} onChange={applyDate}/>
              </AnchoredPopover>}
            </div>
            <div className={styles.popoverAnchor}><button type="button" data-popover-trigger="filter" className={`${styles.pill} ${filterCount ? styles.appliedFilter : ""}`} aria-haspopup="dialog" aria-expanded={popover === "filter"} onClick={() => setPopover(popover === "filter" ? null : "filter")}><Funnel size={16} /><span>Filter{filterCount ? ` (${filterCount})` : ""}</span></button>
              {popover === "filter" && <AnchoredPopover anchor={controls.current?.querySelector('[data-popover-trigger="filter"]') ?? null} panelRef={panel} width={filterDateOpen ? 612 : 280} className={filterStyles.filterGroup} data-date-open={filterDateOpen} role="dialog" aria-label="Filter logs" onKeyDown={event => {
                if (event.key === "Escape" && filterDateOpen) { event.preventDefault(); event.stopPropagation(); setFilterDateOpen(false); filterDateTrigger.current?.focus(); }
              }}>
                <div className={`${filterStyles.panel} ${filterStyles.filterColumn}`}>
                <div className={filterStyles.panelHeading}><Funnel size={15}/><h3>Filter employee logs</h3></div>
                <FilterSelect label="Activity" value={activity} onChange={setActivity} options={[{ value: "", label: "All activities" }, ...activityOptions]}/>
                <FilterSelect label="Field" value={field} onChange={setField} options={[{ value: "", label: "All fields" }, ...fieldOptions]}/>
                <span id="filter-date-label" className={filterStyles.label}>Date range</span>
                <button ref={filterDateTrigger} type="button" className={filterStyles.filterDate} aria-labelledby="filter-date-label filter-date-value" aria-expanded={filterDateOpen} aria-controls={filterDateOpen ? "filter-date-options" : undefined} onClick={() => setFilterDateOpen(!filterDateOpen)}><span id="filter-date-value">{dateFilterLabel(dateFilter)}<small>{rangeDescription(range)}</small></span><ChevronDown size={16} className={filterDateOpen ? filterStyles.rotated : undefined}/></button>
                <div className={styles.filterFooter}><button type="button" onClick={resetFilters}>Reset</button><button type="button" className={styles.primaryButton} onClick={() => { setPopover(null); controls.current?.querySelector<HTMLButtonElement>('[data-popover-trigger="filter"]')?.focus(); }}>Done</button></div>
                </div>
                {filterDateOpen && <div ref={filterDatePanel} id="filter-date-options" className={`${filterStyles.panel} ${filterStyles.dateColumn}`} role="group" aria-label="Choose date range">
                  <DateFilterPanel value={dateFilter} today={today} timezone={data.farm.timezone ?? "America/Los_Angeles"} historyMonth={historyMonth} onChange={applyDate}/>
                </div>}
              </AnchoredPopover>}
            </div>
          </div>
        </div>
        <div className={styles.tableViewport}>
          <table className={styles.table} aria-label="Employee logs">
            <thead><tr className={styles.tableHeader}><th className={styles.checkCell}><SelectionBox label="Select all logs" checked={logs.length > 0 && selectedCount === logs.length} mixed={selectedCount > 0 && selectedCount < logs.length} onChange={selectAll} /></th><th>EMPLOYEE</th><th>ACTIVITY</th><th>DATE</th><th>FIELD</th><th>TIME</th><th aria-label="Actions" /></tr></thead>
            <tbody ref={tableBody} className={`${styles.tableBody} ${!isExpanded && !activityPage && hasFilters ? styles.compactBody : ""}`}>
              {logs.map(log => <Fragment key={log.id}>
                <tr className={`${styles.logRow} ${log.id === data.logs[0]?.id || log.id === expandedId ? styles.highlightedRow : ""} ${selected.has(log.id) ? styles.selectedRow : ""}`} onClick={() => toggleLog(log.id)}>
                  <td className={styles.checkCell}><SelectionBox label={`Select ${log.employee.name}'s log`} checked={selected.has(log.id)} onChange={() => toggleSelected(log.id)} /></td>
                  <td>{log.employee.name}</td><td>{log.activity}</td><td>{formatDate(log.date)}</td><td>{log.field.name}</td><td>{formatTime(log.startAt, data.farm.timezone)} - {formatTime(log.endAt, data.farm.timezone)}</td>
                  <td className={styles.actionCell}><button type="button" className={styles.viewButton} aria-label={`${expandedId === log.id ? "Close" : "View"} ${log.employee.name}'s log`} aria-expanded={expandedId === log.id} aria-controls={expandedId === log.id ? `details-${log.id}` : undefined} onClick={event => { event.stopPropagation(); toggleLog(log.id); }}>{expandedId === log.id ? "Close" : "View"}</button></td>
                </tr>
                {expandedId === log.id && <tr className={styles.detailRow}><td colSpan={7}><LogDetails log={log} tags={tags[log.id] ?? log.tags} onAddTag={() => { setTagLog(log); setTagDraft(""); setTagError(""); }} onExpandMap={() => setMapLog(log)} onRemoveTag={onRemoveTag ? async label => { const saved = await onRemoveTag(log.id, label); setTags(previous => ({ ...previous, [log.id]: saved })); setNotice("Tag removed."); } : undefined} onNotify={setNotice} /></td></tr>}
              </Fragment>)}
              {logs.length === 0 && <tr className={styles.emptyRow}><td colSpan={7}><Search size={22} /><h3>No matching logs</h3><p>{range ? `No logs match your filters for ${rangeDescription(range)}.` : "Try another search or clear your filters."}</p><button type="button" onClick={() => { resetFilters(); setDateFilter({ kind: "all" }); }}>Clear filters</button></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    {mapLog && <MapDialog log={mapLog} onClose={() => setMapLog(null)} />}
    {tagLog && <Modal title="Add a tag" onClose={() => setTagLog(null)}><form className={styles.tagForm} onSubmit={async event => {
      event.preventDefault(); const value = tagDraft.trim();
      if (!value) { setTagError("Enter a tag name."); return; }
      const current = tags[tagLog.id] ?? tagLog.tags;
      if (current.some(tag => tag.toLowerCase() === value.toLowerCase())) { setTagError("This log already has that tag."); return; }
      setTagSaving(true);
      try {
        const saved = onAddTag ? await onAddTag(tagLog.id, value) : [...current, value];
        setTags(previous => ({ ...previous, [tagLog.id]: saved })); setTagLog(null); setNotice("Tag added to the log.");
      } catch (cause) { setTagError(cause instanceof Error ? cause.message : "The tag could not be saved."); }
      finally { setTagSaving(false); }
    }}><p>{tagLog.employee.name} · {tagLog.activity} · {tagLog.field.name}</p><label htmlFor="tag-name">Tag name</label><input id="tag-name" placeholder="e.g. Reviewed" value={tagDraft} onChange={event => { setTagDraft(event.target.value); setTagError(""); }} maxLength={40} data-autofocus aria-invalid={Boolean(tagError)} aria-describedby={tagError ? "tag-error" : undefined} />{tagError && <span id="tag-error" className={styles.formError} role="alert">{tagError}</span>}<div className={styles.suggestedTags}>{["Reviewed", "Follow up", "Equipment"].map(tag => <button type="button" key={tag} onClick={() => setTagDraft(tag)}>{tag}</button>)}</div><div className={styles.dialogActions}><button type="button" className={styles.secondaryButton} onClick={() => setTagLog(null)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={tagSaving}>{tagSaving ? "Saving…" : "Add Tag"}</button></div></form></Modal>}
    {section && <Modal title={section} onClose={() => setSection(null)}><p className={styles.sectionNote}>{section === "Switch User" || section === "Log Out" ? "You’re viewing Bays Ranch as a demo administrator. Account switching and sign-in are outside this dashboard preview." : `${section} is outside this dashboard preview. You can explore employee logs, recordings, tags, and field maps from the dashboard.`}</p><div className={styles.dialogActions}><button type="button" className={styles.primaryButton} onClick={() => setSection(null)}>Back to Dashboard</button></div></Modal>}
    {notice && <div className={styles.toast} role="status"><Check size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}
  </div>;
}
