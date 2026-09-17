"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./filters.module.css";

export function FilterSelect({ label, value, options, onChange, disabled = false }: {
  disabled?: boolean; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const id = useId(); const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typeahead = useRef({ text: "", time: 0 });
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  function reveal(index = selected) { setActive(index); setOpen(true); }
  function choose(index: number) { onChange(options[index].value); setOpen(false); trigger.current?.focus(); }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") { if (open) choose(active); else reveal(); return; }
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !open ? selected : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      reveal(next);
      requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" }));
    } else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === "Tab") setOpen(false);
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now(); const text = (now - typeahead.current.time < 600 ? typeahead.current.text : "") + event.key.toLowerCase();
      typeahead.current = { text, time: now };
      const next = options.findIndex(option => option.label.toLowerCase().startsWith(text));
      if (next >= 0) { reveal(next); requestAnimationFrame(() => document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" })); }
    }
  }
  return <div className={styles.select} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <button disabled={disabled} ref={trigger} type="button" role="combobox" aria-labelledby={`${id}-label`} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-options` : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} className={styles.selectTrigger} onKeyDown={keyDown} onClick={() => open ? setOpen(false) : reveal()}>
      <span>{options[selected]?.label}</span><ChevronDown size={15} aria-hidden className={open ? styles.rotated : undefined}/>
    </button>
    {open && <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className={styles.options}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={value === option.value} className={`${styles.option} ${active === index ? styles.activeOption : ""}`} onMouseMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.label}</span>{value === option.value && <Check size={15} aria-hidden/>}
      </div>)}
    </div>}
  </div>;
}
