// Server-authoritative shop pricing. The editor shows the same numbers as an
// estimate; what Stripe charges is always computed here.

/** Volume discount tiers, checked high to low; the first one cleared applies. */
export const VOLUME_TIERS = [
  { min: 200, off: 0.2 },
  { min: 100, off: 0.15 },
  { min: 50, off: 0.1 },
  { min: 20, off: 0.07 },
  { min: 10, off: 0.05 },
  { min: 5, off: 0.03 },
] as const;

export const SHIPPING_CENTS = 0;
export const CURRENCY = 'CHF';

export interface PricedLine {
  quantity: number;
  unitPriceCents: number;
  discountPercent: number;
  /** quantity x base price, before discount. */
  grossCents: number;
  lineTotalCents: number;
}

/**
 * Prices one order line. The volume discount follows `tierQuantity`, the
 * order's total for this product, so splitting cards over several designs
 * never costs more than one design would.
 */
export function priceLine(
  basePriceCents: number,
  quantity: number,
  tierQuantity: number = quantity,
): PricedLine {
  const off = VOLUME_TIERS.find((t) => tierQuantity >= t.min)?.off ?? 0;
  const unitPriceCents = Math.round(basePriceCents * (1 - off));
  return {
    quantity,
    unitPriceCents,
    discountPercent: Math.round(off * 100),
    grossCents: basePriceCents * quantity,
    lineTotalCents: unitPriceCents * quantity,
  };
}
