import type { InventoryItem } from "@/lib/types/game.types";

interface Props {
  items: InventoryItem[];
}

const CATEGORY_LABEL: Record<InventoryItem["category"], string> = {
  resource: "Resource",
  weapon: "Weapon",
  food: "Food",
  armor: "Armor",
  tool: "Tool",
  currency: "Currency",
};

const CATEGORY_ACCENT: Record<InventoryItem["category"], string> = {
  resource: "border-verdigris/30 text-verdigris",
  weapon: "border-blood/40 text-blood",
  food: "border-gold/30 text-gold",
  armor: "border-parchment-deep/40 text-parchment-dark",
  tool: "border-gold-dim/40 text-gold-dim",
  currency: "border-gold-bright/40 text-gold-bright",
};

export default function InventoryPanel({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="font-serif italic text-parchment-deep">
        Your saddlebag is empty. Work, trade, or fight to fill it.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gold/10">
      {items.map((item) => (
        <li
          key={item.item_type_id}
          className="flex items-center justify-between gap-4 py-2.5"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-gold-bright">
                {item.name}
              </span>
              <span
                className={`font-display uppercase tracking-imperial text-[0.6rem] border px-1.5 py-0.5 rounded-sm ${CATEGORY_ACCENT[item.category]}`}
              >
                {CATEGORY_LABEL[item.category]}
              </span>
            </div>
            {item.description ? (
              <p className="font-serif text-xs text-parchment-deep truncate">
                {item.description}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="font-display text-lg text-gold-bright tabular-nums">
              ×{Math.floor(item.quantity)}
            </div>
            {item.condition !== null ? (
              <div className="text-[0.65rem] text-parchment-deep/80">
                {Math.round(item.condition)}% cond.
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
