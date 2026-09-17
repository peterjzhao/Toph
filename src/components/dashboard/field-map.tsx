"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { fieldMapHref, fieldMapImage, fieldMapRegion, fieldMapRegions } from "@/lib/field-map";
import styles from "./field-map.module.css";

type Field = { id: string; name: string };

export function FieldMap({ field, fields, imageUrl, zoom = 1, onSelect }: {
  field: Field;
  fields: Field[];
  imageUrl?: string | null;
  zoom?: number;
  onSelect?: (fieldId: string) => void;
}) {
  const router = useRouter();
  const source = fieldMapImage(field.id, imageUrl);
  const region = fieldMapRegion(field.id);
  const interactive = region?.imageUrl === source;
  function select(fieldId: string) {
    if (onSelect) onSelect(fieldId);
    else router.push(fieldMapHref(fieldId));
  }
  const image = <img className={styles.image} src={source} alt={`Satellite map of ${field.name}`} draggable={false} width={interactive ? region.sourceSize.width : undefined} height={interactive ? region.sourceSize.height : undefined} />;
  return <div className={styles.canvas} style={{ width: `${zoom * 100}%` }}>
    {interactive ? image : <Link href={fieldMapHref(field.id)} aria-label={`Open ${field.name}`}>{image}</Link>}
    {interactive && <svg className={styles.regions} viewBox="0 0 1 1" preserveAspectRatio="none" role="group" aria-label="Select a field on the map">
      {fieldMapRegions.map(region => {
        const target = fields.find(item => item.id === region.fieldId);
        if (!target) return null;
        return <a key={target.id} href={fieldMapHref(target.id)} tabIndex={0} className={styles.region} aria-label={`Open ${target.name}`} aria-current={target.id === field.id ? "true" : undefined} onKeyDown={event => {
          if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          select(target.id);
        }} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          select(target.id);
        }}>
          <title>{target.name}</title>
          <polygon points={region.polygon.map(point => point.join(",")).join(" ")} vectorEffect="non-scaling-stroke" />
        </a>;
      })}
    </svg>}
  </div>;
}
