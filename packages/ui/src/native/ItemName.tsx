import { Text, type TextProps } from 'react-native';
import { rarityColors, type Rarity } from '../index';

/** An item's name in its rarity color (GDD 4.5). */
export function ItemName({ rarity, style, ...props }: TextProps & { rarity: Rarity }) {
  return <Text {...props} style={[{ color: rarityColors[rarity], fontWeight: '600' }, style]} />;
}
