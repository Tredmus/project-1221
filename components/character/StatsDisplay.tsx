interface Props {
  strength: number;
  craft: number;
  charisma: number;
  intelligence: number;
}

const STATS: Array<{ key: keyof Props; label: string; blurb: string }> = [
  { key: "strength", label: "Strength", blurb: "Hammer, shield, plough." },
  { key: "craft", label: "Craft", blurb: "The hand that shapes." },
  { key: "charisma", label: "Charisma", blurb: "The voice that bends." },
  { key: "intelligence", label: "Intelligence", blurb: "The mind that schemes." },
];

export default function StatsDisplay(props: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STATS.map((s) => (
        <div
          key={s.key}
          className="border border-gold/15 bg-imperial-shadow/40 rounded-sm p-3"
        >
          <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
            {s.label}
          </div>
          <div className="mt-1 font-display text-3xl text-gold-bright tabular-nums">
            {props[s.key]}
          </div>
          <p className="mt-1 font-serif italic text-xs text-parchment-deep/80">
            {s.blurb}
          </p>
        </div>
      ))}
    </div>
  );
}
