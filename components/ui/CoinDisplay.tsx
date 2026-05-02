interface Props {
  coins: number;
  gems: number;
  /** Render in a horizontal compact form for top nav bars. */
  compact?: boolean;
}

const formatNumber = (n: number) =>
  Math.floor(n).toLocaleString("en-US");

export default function CoinDisplay({ coins, gems, compact = false }: Props) {
  if (compact) {
    return (
      <div className="flex items-center gap-4 font-display text-sm">
        <span className="flex items-baseline gap-1.5">
          <span className="text-gold-bright tabular-nums">
            {formatNumber(coins)}
          </span>
          <span className="text-gold-dim text-[0.65rem] uppercase tracking-imperial">
            coin
          </span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-verdigris tabular-nums">
            {formatNumber(gems)}
          </span>
          <span className="text-gold-dim text-[0.65rem] uppercase tracking-imperial">
            gem
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="border border-gold/20 bg-imperial-shadow/40 rounded-sm p-3">
        <div className="label-imperial mb-0">Coins</div>
        <div className="font-display text-2xl text-gold-bright tabular-nums">
          {formatNumber(coins)}
        </div>
      </div>
      <div className="border border-verdigris/30 bg-imperial-shadow/40 rounded-sm p-3">
        <div className="label-imperial mb-0">Gems</div>
        <div className="font-display text-2xl text-verdigris tabular-nums">
          {formatNumber(gems)}
        </div>
      </div>
    </div>
  );
}
