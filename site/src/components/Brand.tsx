import { cx } from './ui';

/** Logo files are synced from ../brand/logo by scripts/sync-brand.mjs. */
export function Logo({ inverse = false, className, height = 32 }: { inverse?: boolean; className?: string; height?: number }) {
  const width = Math.round((212.97 / 64) * height);
  return (
    <img
      src={inverse ? '/brand/cortex-logo-inverse.svg' : '/brand/cortex-logo.svg'}
      alt="Cortex"
      width={width}
      height={height}
      className={cx('block', className)}
      decoding="async"
    />
  );
}

/**
 * Decorative texture derived from the symbol: concentric "C" arcs opening to the
 * right (same ~42° opening as the logo), with the amber signal dot optional.
 */
export function ArcPattern({
  className,
  rings = 9,
  start = 70,
  step = 52,
  withDot = true,
}: {
  className?: string;
  rings?: number;
  start?: number;
  step?: number;
  withDot?: boolean;
}) {
  const size = start + step * (rings - 1) + 20;
  const c = size; // centre sits at the middle of a 2*size box
  const angle = (42 * Math.PI) / 180;
  const paths: string[] = [];
  for (let i = 0; i < rings; i += 1) {
    const r = start + step * i;
    const x = (c + r * Math.cos(angle)).toFixed(2);
    const y1 = (c - r * Math.sin(angle)).toFixed(2);
    const y2 = (c + r * Math.sin(angle)).toFixed(2);
    paths.push(`M${x} ${y1}A${r} ${r} 0 1 0 ${x} ${y2}`);
  }
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${size * 2} ${size * 2}`}
      className={cx('pointer-events-none select-none', className)}
      fill="none"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth={i % 3 === 0 ? 2.5 : 1.25} strokeLinecap="round" />
      ))}
      {withDot ? <circle cx={c + start * 0.95} cy={c} r={9} className="fill-signal" /> : null}
    </svg>
  );
}
