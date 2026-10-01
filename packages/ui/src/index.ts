/**
 * Design tokens shared by the game app and the admin. The visual identity isn't designed
 * yet (GDD 12); only the rarity colors are settled (GDD 4.5).
 */
export const RARITIES = ['common', 'fine', 'superior', 'masterwork', 'renowned', 'relic'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Grey, green, blue, purple, orange, gold. */
export const rarityColors: Record<Rarity, string> = {
  common: '#9D9D9D',
  fine: '#2FA84F',
  superior: '#3478E0',
  masterwork: '#9B4DDB',
  renowned: '#E8821E',
  relic: '#D4A72C',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
