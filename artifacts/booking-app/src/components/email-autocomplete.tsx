import React, { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

// Email input with quick-pick domain endings for the most common providers.
// As soon as the dispatcher types a name (or name@), clickable suggestions
// appear: name@gmail.com, name@hotmail.com, name@outlook.com, name@yahoo.com.

const TOP_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com"];

interface Props extends Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

export function EmailAutocomplete({ value, onChange, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useMemo(() => {
    const v = (value ?? "").trim();
    if (!v) return [];
    const at = v.indexOf("@");
    const local = at === -1 ? v : v.slice(0, at);
    const domainPart = at === -1 ? "" : v.slice(at + 1).toLowerCase();
    if (!local) return [];
    return TOP_DOMAINS
      .filter(d => d.startsWith(domainPart) && d !== domainPart)
      .map(d => `${local}@${d}`);
  }, [value]);

  return (
    <div className="relative">
      <Input
        type="email"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 150); }}
        {...rest}
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {suggestions.map(s => (
            <button
              type="button"
              key={s}
              // onMouseDown fires before the input's blur, so the click always lands
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setFocused(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
