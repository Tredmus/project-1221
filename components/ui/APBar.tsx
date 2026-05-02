interface Props {
  current: number;
  max: number;
  /** Visually compact variant for nav bars. */
  compact?: boolean;
}

export default function APBar({ current, max, compact = false }: Props) {
  const safeMax = Math.max(max, 1);
  const pct = Math.max(0, Math.min(100, (current / safeMax) * 100));
  const low = current / safeMax < 0.25;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
          AP
        </span>
        <div className="relative h-2 w-24 overflow-hidden rounded-sm border border-gold/30 bg-imperial-shadow">
          <div
            className={`h-full transition-all ${
              low ? "bg-blood/80" : "bg-gold/70"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-display text-xs text-gold-bright tabular-nums">
          {current}
          <span className="text-gold-dim">/{max}</span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="label-imperial mb-0">Action points</span>
        <span className="font-display text-sm text-gold-bright tabular-nums">
          {current}
          <span className="text-gold-dim">/{max}</span>
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-sm border border-gold/30 bg-imperial-shadow">
        <div
          className={`h-full transition-all ${
            low ? "bg-blood/80" : "bg-gold/70"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-parchment-deep/70">
        Resets at midnight UTC.
      </p>
    </div>
  );
}
