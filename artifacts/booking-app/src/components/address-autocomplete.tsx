import React, { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, MapPin } from "lucide-react";

export interface PlaceResult {
  formattedAddress: string;
  /** Street only, e.g. "123 Main St NW" */
  address: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number;
  lng: number;
}

interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

function getApiBase() {
  const base = import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

export interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: PlaceResult) => void;
  placeholder?: string;
  className?: string;
  /** Called each time the user types (before a place is selected) */
  onManualChange?: () => void;
}

export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelect,
  placeholder,
  className,
  onManualChange,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent re-fetching when we programmatically set the input after a selection
  const suppressNextFetch = useRef(false);

  const fetchPredictions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${getApiBase()}api/places/autocomplete?input=${encodeURIComponent(input)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        const preds: Prediction[] = data.predictions ?? [];
        setPredictions(preds);
        setOpen(preds.length > 0);
        setActiveIndex(-1);
      }
    } catch {
      /* network error — fail silently */
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    onManualChange?.();
    if (suppressNextFetch.current) {
      suppressNextFetch.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchPredictions(v), 300);
  };

  const selectPrediction = async (prediction: Prediction) => {
    // Set input to the street-only part (main text)
    suppressNextFetch.current = true;
    onChange(prediction.mainText);
    setOpen(false);
    setPredictions([]);

    if (!onPlaceSelect) return;

    try {
      const res = await fetch(
        `${getApiBase()}api/places/details?placeId=${encodeURIComponent(prediction.placeId)}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const place: PlaceResult = await res.json();
        onPlaceSelect(place);
      }
    } catch {
      /* fail silently — the street text is already set */
    }
  };

  // Close dropdown when user clicks outside
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectPrediction(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground pointer-events-none" />
      )}
      {open && predictions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden"
        >
          {predictions.map((p, i) => (
            <li
              key={p.placeId}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "flex items-start gap-2 px-3 py-2 cursor-pointer text-sm select-none",
                i === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on input
                selectPrediction(p);
              }}
            >
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <span className="font-medium">{p.mainText}</span>
                {p.secondaryText && (
                  <span className="block text-xs text-muted-foreground truncate">
                    {p.secondaryText}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
