"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";

export function AnchoredPopover({ anchor, panelRef, width, children, ...props }: {
  anchor: HTMLElement | null; panelRef: RefObject<HTMLDivElement | null>; width: number; children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const [position, setPosition] = useState({ left: 0, top: 0, width, maxHeight: 500, visibility: "hidden" as "hidden" | "visible" });
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 12; const gap = 8;
      const availableBelow = window.innerHeight - rect.bottom - gap - margin;
      const availableAbove = rect.top - gap - margin;
      const above = availableBelow < 300 && availableAbove > availableBelow;
      const maxHeight = Math.max(100, above ? availableAbove : availableBelow);
      const panelWidth = Math.min(width, window.innerWidth - margin * 2);
      const height = Math.min(panelRef.current?.scrollHeight ?? 400, maxHeight);
      const next = { left: Math.max(margin, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - margin)), top: above ? Math.max(margin, rect.top - gap - height) : rect.bottom + gap, width: panelWidth, maxHeight, visibility: "visible" as const };
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, panelRef, width]);
  return createPortal(<div {...props} ref={panelRef} style={{ ...props.style, ...position, position: "fixed", zIndex: 40, overflowY: "auto", overscrollBehavior: "contain" }}>{children}</div>, document.body);
}
