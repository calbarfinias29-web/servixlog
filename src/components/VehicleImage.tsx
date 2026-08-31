import { useEffect, useState } from 'react';
import type { Car } from '@/types';
import { vehicleImageSources } from '@/lib/vehicleCatalog';

/**
 * Imaginea mașinii din dashboard. Lanț de fallback fără imagini sparte:
 * photo_url → <marca>/<model>/<decada>.png → <marca>/<model>.png → <marca>.svg
 * → placeholder (prop-ul `fallback`, de obicei silueta ServiceX din PanouAngajat).
 */
export function VehicleImage({ car, fallback, className, style }: { car: Car | null; fallback?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const chain = car ? vehicleImageSources(car.make, car.model, car.year, car.photo_url) : null;
  const key = chain ? chain.sources.join('|') : '';
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [key]);

  if (!chain || idx >= chain.sources.length) return <>{fallback ?? null}</>;

  const imgKey = car ? `${car.make ?? ''}|${car.model ?? ''}|${car.year ?? ''}|${chain.sources[idx]}` : `empty-${idx}`;

  return (
    <img
      key={imgKey}
      src={chain.sources[idx]}
      alt={car ? [car.make, car.model].filter(Boolean).join(' ') || 'Mașină' : 'Mașină'}
      onError={() => setIdx((i) => i + 1)}
      loading="eager"
      className={className}
      style={style}
      draggable={false}
    />
  );
}
