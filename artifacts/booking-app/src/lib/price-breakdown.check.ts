/**
 * Scripted assertions for buildPriceBreakdown.
 * No test framework is configured in booking-app, so run manually:
 *   cd artifacts/booking-app && pnpm exec tsx src/lib/price-breakdown.check.ts
 */
import { buildPriceBreakdown, type PriceBreakdown, type PriceBreakdownInputs } from "./price-breakdown";
import assert from "node:assert";

// Every persisted breakdown must reconcile: base − discounts + fuel === total
const sum = (pb: PriceBreakdown) =>
  Math.round((
    (pb.baseAmount ?? pb.manualPrice ?? 0)
    - (pb.leadDiscount ?? 0)
    - (pb.quickDiscountTens ?? 0) * 10
    - (pb.quickDiscountTwenties ?? 0) * 20
    - (pb.loyaltyDiscount ?? 0)
    + (pb.fuelSurcharge ?? 0)
  ) * 100) / 100;

const base: PriceBreakdownInputs = {
  finalPrice: 0, hours: NaN, hourlyRate: 105, leadSource: null,
  leadDiscountApplied: false, tenCount: 0, twentyCount: 0,
  loyaltyApplied: false, loyaltyAmount: 0, fuelSurcharge: NaN,
  manualPriceEntered: false,
};

// 1. Full hours-derived combo: 2.5h × $105 = 262.50, lead −10, −10×1, −20×1,
//    loyalty 22.25 → 200.25 + fuel 12.50 = 212.75
let pb = buildPriceBreakdown({ ...base, finalPrice: 200.25, hours: 2.5, leadSource: "Google", leadDiscountApplied: true, tenCount: 1, twentyCount: 1, loyaltyApplied: true, loyaltyAmount: 22.25, fuelSurcharge: 12.5 });
assert.strictEqual(pb.total, 212.75);
assert.strictEqual(sum(pb), pb.total, "combo arithmetic");

// 2. Manual price typed over the default hours/rate (1 × $105): breakdown must
//    record the manual price, NOT the stale hours × rate base.
pb = buildPriceBreakdown({ ...base, finalPrice: 200, hours: 1, fuelSurcharge: 12.5, manualPriceEntered: true });
assert.strictEqual(pb.baseAmount, undefined, "no stale hours×rate base after manual edit");
assert.strictEqual(pb.hours, undefined);
assert.strictEqual(pb.manualPrice, 200);
assert.strictEqual(pb.total, 212.5);
assert.strictEqual(sum(pb), pb.total, "manual price reconciles");

// 3. Manual price after a lead discount was applied (form resets the lead
//    discount on manual edits): no discount lines survive.
pb = buildPriceBreakdown({ ...base, finalPrice: 200, hours: 1, leadSource: "Facebook", leadDiscountApplied: false, manualPriceEntered: true, fuelSurcharge: 0 });
assert.strictEqual(pb.leadDiscount, undefined, "lead discount cleared by manual edit");
assert.strictEqual(pb.manualPrice, 200);
assert.strictEqual(pb.total, 200);
assert.strictEqual(sum(pb), pb.total);

// 4. Discounts applied AFTER a manual price: manualPrice is reconstructed
//    pre-discount so lines reconcile. Typed $200, then lead −10 and −$20 → 170.
pb = buildPriceBreakdown({ ...base, finalPrice: 170, hours: 1, leadSource: "Referral", leadDiscountApplied: true, twentyCount: 1, manualPriceEntered: true, fuelSurcharge: 12.5 });
assert.strictEqual(pb.manualPrice, 200);
assert.strictEqual(pb.total, 182.5);
assert.strictEqual(sum(pb), pb.total, "post-manual discounts reconcile");

// 5. Loyalty applied then invalidated (manual edit resets loyaltyApplied/amount)
pb = buildPriceBreakdown({ ...base, finalPrice: 200, loyaltyAmount: 10, manualPriceEntered: true, fuelSurcharge: 0 });
assert.strictEqual(pb.loyaltyDiscount, undefined, "no loyalty line after invalidation");
assert.strictEqual(pb.total, 200);
assert.strictEqual(sum(pb), pb.total);

// 6. Recompute from hours after loyalty (loyaltyApplied reset): 3 × 52.5 = 157.50 + fuel
pb = buildPriceBreakdown({ ...base, finalPrice: 157.5, hours: 3, hourlyRate: 52.5, loyaltyAmount: 22.25, fuelSurcharge: 12.5 });
assert.strictEqual(pb.loyaltyDiscount, undefined);
assert.strictEqual(pb.total, 170);
assert.strictEqual(sum(pb), pb.total);

// 7. Lead + quick discounts, no fuel: 2 × 105 = 210, −10 lead, −10×2 → 180
pb = buildPriceBreakdown({ ...base, finalPrice: 180, hours: 2, leadSource: "Referral", leadDiscountApplied: true, tenCount: 2 });
assert.strictEqual(pb.fuelSurcharge, undefined);
assert.strictEqual(pb.total, 180);
assert.strictEqual(sum(pb), pb.total);

// 8. Loyalty on hours-derived quote: 262.5 → loyalty 26.25 → 236.25 + fuel 12.5
pb = buildPriceBreakdown({ ...base, finalPrice: 236.25, hours: 2.5, loyaltyApplied: true, loyaltyAmount: 26.25, fuelSurcharge: 12.5 });
assert.strictEqual(pb.total, 248.75);
assert.strictEqual(sum(pb), pb.total);

// 9. Low custom rate ($5/hr × 1h) with a lead source selected: the form
//    refuses the $10 discount (price would go negative), so leadDiscountApplied
//    stays false and only the source is recorded. Base $5 + fuel $12.50 = $17.50.
pb = buildPriceBreakdown({ ...base, finalPrice: 5, hours: 1, hourlyRate: 5, leadSource: "Google", leadDiscountApplied: false, fuelSurcharge: 12.5 });
assert.strictEqual(pb.leadDiscount, undefined, "refused lead discount is not persisted");
assert.strictEqual(pb.leadSource, "Google");
assert.strictEqual(pb.total, 17.5);
assert.strictEqual(sum(pb), pb.total, "low-rate lead-source case reconciles");

// 10. Over-applied quick discounts are refused by the form: $25 quote allows
//     one −$20 tap ($5 left) but the second tap is rejected, so twentyCount
//     stays 1. Base $25 − $20 = $5 + fuel $12.50 = $17.50.
pb = buildPriceBreakdown({ ...base, finalPrice: 5, hours: NaN, twentyCount: 1, manualPriceEntered: true, fuelSurcharge: 12.5 });
assert.strictEqual(pb.manualPrice, 25);
assert.strictEqual(pb.quickDiscountTwenties, 1, "only the applied tap is persisted");
assert.strictEqual(pb.total, 17.5);
assert.strictEqual(sum(pb), pb.total, "over-applied quick discount case reconciles");

// 11. Canonical ordering — loyalty applied LAST after lead + quick discounts
//     (the form blocks other discount controls while loyalty is active):
//     2h × $105 = 210, lead −10, −$20 → 180, loyalty 10% = 18 → 162 + fuel 12.50
pb = buildPriceBreakdown({ ...base, finalPrice: 162, hours: 2, leadSource: "Google", leadDiscountApplied: true, twentyCount: 1, loyaltyApplied: true, loyaltyAmount: 18, fuelSurcharge: 12.5 });
assert.strictEqual(pb.total, 174.5);
assert.strictEqual(sum(pb), pb.total, "loyalty-last ordering reconciles");
assert.strictEqual(pb.loyaltyDiscount, 18, "loyalty is 10% of the post-flat-discount amount (210−10−20=180 → 18)");

// 12. Loyalty last on a manual price with a later-refused control: typed $50,
//     loyalty 10% = 5 → 45 + fuel 12.50 (further discounts blocked while loyalty active)
pb = buildPriceBreakdown({ ...base, finalPrice: 45, manualPriceEntered: true, loyaltyApplied: true, loyaltyAmount: 5, fuelSurcharge: 12.5 });
assert.strictEqual(pb.manualPrice, 50);
assert.strictEqual(pb.total, 57.5);
assert.strictEqual(sum(pb), pb.total, "manual + loyalty-last reconciles");

// 13. Loyalty withdrawn when the phone/customer match changes: the form adds
//     the loyalty amount back onto the quote before clearing loyalty state,
//     so the hours-derived base reconciles with the restored total.
//     2h × $105 = 210, loyalty 21 → 189, phone changed → restored to 210 + fuel.
pb = buildPriceBreakdown({ ...base, finalPrice: 210, hours: 2, loyaltyApplied: false, loyaltyAmount: 0, fuelSurcharge: 12.5 });
assert.strictEqual(pb.baseAmount, 210);
assert.strictEqual(pb.loyaltyDiscount, undefined, "withdrawn loyalty leaves no line");
assert.strictEqual(pb.total, 222.5);
assert.strictEqual(sum(pb), pb.total, "loyalty withdrawal restores a reconciling quote");

console.log("All price-breakdown checks PASSED");
