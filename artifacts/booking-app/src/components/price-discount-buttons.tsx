import React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared quick-discount controls for the quoted/estimated price field.
 * Used by both New Booking and Edit Booking so the −$10/−$20 buttons (tap
 * counters + undo) and the 10% loyalty discount behave identically:
 * - cent rounding everywhere
 * - discounts are REFUSED (with a toast) rather than clamped when the price
 *   would go below $0, so any persisted breakdown always reconciles
 * - the loyalty discount is always applied LAST; while active, other discount
 *   controls are blocked until it is removed
 *
 * Fully controlled: the parent owns the tap counters and loyalty state so it
 * can reset them on manual price edits and persist them (price breakdown).
 */
export interface DiscountCounts {
  ten: number;
  twenty: number;
}

export interface LoyaltyState {
  applied: boolean;
  /** Dollar amount removed when the 10% discount was applied. */
  amount: number;
}

export interface PriceDiscountButtonsProps {
  /** Current price field value (string or number, as stored by the form). */
  value: unknown;
  /** Called with the adjusted price (rounded to cents). */
  onApply: (newPrice: number) => void;
  counts: DiscountCounts;
  onCountsChange: (next: DiscountCounts) => void;
  /** Whether the customer qualifies for the 10% loyalty discount. */
  loyaltyEligible: boolean;
  loyalty: LoyaltyState;
  onLoyaltyChange: (next: LoyaltyState) => void;
}

const FLAT_DISCOUNTS = [
  { off: 10, key: "ten" as const },
  { off: 20, key: "twenty" as const },
];

function roundCents(n: number) {
  return Math.round(n * 100) / 100;
}

export function PriceDiscountButtons({
  value,
  onApply,
  counts,
  onCountsChange,
  loyaltyEligible,
  loyalty,
  onLoyaltyChange,
}: PriceDiscountButtonsProps) {
  const { toast } = useToast();
  const totalOff = counts.ten * 10 + counts.twenty * 20;

  const currentPrice = () => {
    const current = parseFloat(String(value));
    if (!isFinite(current) || current <= 0) {
      toast({ title: "Enter a price first", description: "Type the quoted price, then apply the discount." });
      return null;
    }
    return current;
  };

  // Canonical discount ordering: the 10% loyalty discount is always applied
  // LAST. While it's active, other discount controls are blocked.
  const guardLoyaltyLast = (): boolean => {
    if (loyalty.applied) {
      toast({ title: "Remove the loyalty discount first", description: "The 10% loyalty discount is applied last — remove it, adjust the price, then re-apply it." });
      return true;
    }
    return false;
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {FLAT_DISCOUNTS.map(({ off, key }) => {
          const count = counts[key];
          return (
            <div key={off} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (guardLoyaltyLast()) return;
                  const current = currentPrice();
                  if (current === null) return;
                  if (current - off < 0) {
                    toast({ title: "Price too low for this discount", description: `The quote must be at least $${off} to apply it.` });
                    return;
                  }
                  onApply(roundCents(current - off));
                  onCountsChange({ ...counts, [key]: count + 1 });
                }}
                className={cn(
                  "text-xs font-semibold rounded-full px-3 py-1 border transition-colors",
                  count > 0
                    ? "bg-primary text-white border-primary"
                    : "text-primary border-primary/30 bg-background hover:bg-primary/10"
                )}
              >
                −${off} off{count > 0 && ` ×${count}`}
              </button>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (guardLoyaltyLast()) return;
                    const current = parseFloat(String(value));
                    if (!isFinite(current)) return;
                    onApply(roundCents(current + off));
                    onCountsChange({ ...counts, [key]: count - 1 });
                  }}
                  className="text-xs text-muted-foreground border border-border rounded-full px-2 py-1 hover:bg-muted transition-colors"
                  title={`Undo one −$${off}`}
                >
                  ↩ undo
                </button>
              )}
            </div>
          );
        })}
        {totalOff > 0 && (
          <span className="text-xs font-medium text-green-700 dark:text-green-400">
            −${totalOff} in quick discounts
          </span>
        )}
      </div>
      {loyaltyEligible && (
        loyalty.applied ? (
          <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1 mt-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> 10% loyalty discount applied (−${loyalty.amount.toFixed(2)})
            <button
              type="button"
              onClick={() => {
                const current = parseFloat(String(value));
                if (isFinite(current)) onApply(roundCents(current + loyalty.amount));
                onLoyaltyChange({ applied: false, amount: 0 });
              }}
              className="ml-1 text-muted-foreground border border-border rounded-full px-2 py-0.5 hover:bg-muted transition-colors"
              title="Remove the loyalty discount"
            >
              ↩ remove
            </button>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              const current = currentPrice();
              if (current === null) return;
              const discounted = roundCents(current * 0.9);
              onApply(discounted);
              onLoyaltyChange({ applied: true, amount: roundCents(current - discounted) });
            }}
            className="text-xs font-semibold text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 rounded-full px-3 py-1 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors mt-2"
          >
            Apply 10% loyalty discount
          </button>
        )
      )}
    </>
  );
}
