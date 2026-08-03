/**
 * Pure helper that builds the itemized price breakdown persisted with a
 * booking. Kept free of React state so the arithmetic can be tested in
 * isolation (see price-breakdown.check.ts, run manually with
 * `pnpm exec tsx src/lib/price-breakdown.check.ts`).
 *
 * The `finalPrice` passed in is the quoted price BEFORE the fuel surcharge;
 * the returned `total` includes the surcharge, matching what is saved as
 * `estimatedPrice`.
 */
export interface PriceBreakdown {
  hours?: number;
  hourlyRate?: number;
  baseAmount?: number;
  /** Manually entered price before discounts — used instead of hours × rate. */
  manualPrice?: number;
  leadSource?: string;
  leadDiscount?: number;
  quickDiscountTens?: number;
  quickDiscountTwenties?: number;
  loyaltyDiscount?: number;
  fuelSurcharge?: number;
  total: number;
}

export interface PriceBreakdownInputs {
  /** Quoted price before the fuel surcharge (the form's estimatedPrice field). */
  finalPrice: number;
  hours: number;              // may be NaN when not derived from hours × rate
  hourlyRate: number;
  leadSource: string | null;
  leadDiscountApplied: boolean;
  tenCount: number;
  twentyCount: number;
  loyaltyApplied: boolean;
  loyaltyAmount: number;
  fuelSurcharge: number;      // may be NaN
  /**
   * True when the dispatcher typed the quoted price directly instead of
   * deriving it from hours × rate. The breakdown then records a manualPrice
   * base (reconstructed so all lines reconcile to the total) rather than a
   * potentially unrelated hours × rate amount.
   */
  manualPriceEntered: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildPriceBreakdown(i: PriceBreakdownInputs): PriceBreakdown {
  const fuel = isFinite(i.fuelSurcharge) && i.fuelSurcharge > 0 ? i.fuelSurcharge : 0;
  const manual = i.manualPriceEntered || !(isFinite(i.hours) && i.hours > 0);
  // Pre-discount base for a manually entered price: final price plus every
  // discount applied after it, so all lines reconcile exactly to the total.
  const discounts =
    (i.leadDiscountApplied ? 10 : 0) +
    i.tenCount * 10 +
    i.twentyCount * 20 +
    (i.loyaltyApplied && i.loyaltyAmount > 0 ? i.loyaltyAmount : 0);
  return {
    ...(manual
      ? { manualPrice: round2(i.finalPrice + discounts) }
      : { hours: i.hours, hourlyRate: i.hourlyRate, baseAmount: round2(i.hours * i.hourlyRate) }),
    ...(i.leadSource ? { leadSource: i.leadSource } : {}),
    ...(i.leadDiscountApplied ? { leadDiscount: 10 } : {}),
    ...(i.tenCount > 0 ? { quickDiscountTens: i.tenCount } : {}),
    ...(i.twentyCount > 0 ? { quickDiscountTwenties: i.twentyCount } : {}),
    ...(i.loyaltyApplied && i.loyaltyAmount > 0 ? { loyaltyDiscount: i.loyaltyAmount } : {}),
    ...(fuel > 0 ? { fuelSurcharge: fuel } : {}),
    total: round2(i.finalPrice + fuel),
  };
}
