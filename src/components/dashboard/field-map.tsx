"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useId, useState } from "react";
import { tokens } from "@toph/design";
import { fieldMapHref, fieldMapImage, fieldMapRegion, fieldMapRegions } from "@/lib/field-map";
import { fieldPresentation } from "@/lib/field-outline";
import styles from "./field-map.module.css";

type Field = { id: string; name: string; boundary?: Array<{ x: number; y: number }> };

export function FieldMap({ field, fields, imageUrl, zoom = 1, showLogMarker = false, onSelect }: {
  field: Field;
  fields: Field[];
  imageUrl?: string | null;
  zoom?: number;
  showLogMarker?: boolean;
  onSelect?: (fieldId: string) => void;
}) {
  const router = useRouter();
  const markerGradient = useId();
  const [imageSize, setImageSize] = useState({ source: "", width: 1, height: 1 });
  const source = fieldMapImage(field.id, imageUrl);
  const region = fieldMapRegion(field.id);
  const custom = Boolean(field.boundary?.length);
  const interactive = custom || region?.imageUrl === source;
  const size = imageSize.source === source ? imageSize : { width: 1, height: 1 };
  const marker = custom && showLogMarker && size.width > 1 ? fieldPresentation(field.boundary!, size.width, size.height).marker : null;
  const regions = custom
    ? fields.filter(item => item.boundary?.length).map(item => ({ fieldId: item.id, polygon: item.boundary!.map(point => [point.x, point.y]) }))
    : fieldMapRegions;
  function select(fieldId: string) {
    if (onSelect) onSelect(fieldId);
    else router.push(fieldMapHref(fieldId));
  }
  const image = <img className={styles.image} src={source} alt={`Satellite map of ${field.name}`} draggable={false} onLoad={event => { const image = event.currentTarget; setImageSize({ source, width: image.naturalWidth, height: image.naturalHeight }); }} width={!custom && region ? region.sourceSize.width : undefined} height={!custom && region ? region.sourceSize.height : undefined} />;
  return <div className={styles.canvas} style={{ width: `${zoom * 100}%` }}>
    {interactive ? image : <Link href={fieldMapHref(field.id)} aria-label={`Open ${field.name}`}>{image}</Link>}
    {interactive && <svg className={styles.regions} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="group" aria-label="Select a field on the map">
      {regions.map(region => {
        const target = fields.find(item => item.id === region.fieldId);
        if (!target) return null;
        return <a key={target.id} href={fieldMapHref(target.id)} tabIndex={0} className={`${styles.region} ${custom && target.id === field.id ? styles.selectedRegion : ""}`} aria-label={`Open ${target.name}`} aria-current={target.id === field.id ? "true" : undefined} onKeyDown={event => {
          if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          select(target.id);
        }} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          select(target.id);
        }}>
          <title>{target.name}</title>
          {custom ? <path d={fieldPresentation(region.polygon.map(([x, y]) => ({ x, y })), size.width, size.height).path} vectorEffect="non-scaling-stroke" />
            : <polygon points={region.polygon.map(([x, y]) => `${x * size.width},${y * size.height}`).join(" ")} vectorEffect="non-scaling-stroke" />}
        </a>;
      })}
      {marker && marker.radius > 0 && <svg className={styles.logMarker} x={marker.x - marker.radius} y={marker.y - marker.radius} width={marker.radius * 2} height={marker.radius * 2} viewBox="0 0 17 17" aria-hidden="true" data-log-field-marker="true">
        <defs><linearGradient id={markerGradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor={tokens.colors.fieldOutline} /><stop offset="1" stopColor={tokens.colors.fieldMarkerEnd} /></linearGradient></defs>
        <circle cx="8.5" cy="8.5" r="8.5" fill={`url(#${markerGradient})`} />
        <circle cx="8.5" cy="8.5" r="7.5" fill="none" stroke="white" strokeWidth="2" />
      </svg>}
    </svg>}
  </div>;
}
