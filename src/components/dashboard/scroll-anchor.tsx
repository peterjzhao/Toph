"use client";

import { Component, createRef, type ReactNode } from "react";

type Props = {
  className?: string;
  /** Rows are re-anchored only when this value changes (new data), never for a sort or filter change. */
  watch: unknown;
  children: ReactNode;
};
type Snapshot = { row: HTMLElement; top: number; scroller: HTMLElement } | null;

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Keeps the rows a person is reading in place when a live update adds or removes rows above
 * them. Browsers' own scroll anchoring does not apply to inserted table rows. While the top of
 * the list is on screen nothing is adjusted, so a new first row simply appears.
 */
export class ScrollAnchor extends Component<Props, object, Snapshot> {
  private container = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.watch === this.props.watch) return null;
    const scroller = scrollParent(this.container.current);
    const rows = this.container.current?.querySelectorAll<HTMLElement>("tbody > tr");
    if (!scroller || !rows?.length) return null;
    const edge = scroller.getBoundingClientRect().top;
    if (rows[0].getBoundingClientRect().top >= edge) return null;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (box.bottom > edge) return { row, top: box.top, scroller };
    }
    return null;
  }

  componentDidUpdate(_previous: Props, _state: object, snapshot: Snapshot) {
    if (!snapshot?.row.isConnected) return;
    const moved = snapshot.row.getBoundingClientRect().top - snapshot.top;
    if (moved !== 0) snapshot.scroller.scrollTop += moved;
  }

  render() {
    return <div ref={this.container} className={this.props.className}>{this.props.children}</div>;
  }
}
