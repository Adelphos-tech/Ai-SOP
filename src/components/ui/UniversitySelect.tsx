"use client";

// ============================================================
// UniversitySelect — canonical searchable university selector.
// Single source: GET /api/application/universities
// ("General" first, then every university already known by the app).
//
// - case-insensitive partial search ("aal" → Aalen University)
// - keyboard accessible (combobox: arrows/Enter/Escape)
// - responsive full-width dropdown
// - unknown values keep the existing free-text fallback:
//   "University not found — saved as entered" (no silent duplicates)
// ============================================================

import { useState, useEffect, useRef, useMemo } from "react";
import { inputClass } from "./FormField";

interface UniversitySelectProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  id?: string;
}

let cachedUniversities: string[] | null = null;

export function UniversitySelect({ value, onChange, required, placeholder, id }: UniversitySelectProps) {
  const [universities, setUniversities] = useState<string[]>(cachedUniversities || []);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (cachedUniversities) return;
    fetch("/api/application/universities")
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.universities) {
          cachedUniversities = data.universities;
          setUniversities(data.universities);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return universities;
    return universities.filter(u => u.toLowerCase().includes(q));
  }, [universities, value]);

  const exactMatch = useMemo(
    () => universities.some(u => u.toLowerCase() === value.trim().toLowerCase()),
    [universities, value],
  );
  const showNotFound = value.trim().length > 0 && !exactMatch && filtered.length === 0;

  function select(name: string) {
    onChange(name);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        select(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  useEffect(() => {
    if (open && listRef.current) {
      const el = listRef.current.children[highlight] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlight, open]);

  const listboxId = `${id || "university"}-listbox`;

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={inputClass}
        value={value}
        required={required}
        placeholder={placeholder || "Search university..."}
        autoComplete="off"
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          ref={listRef}
          className="absolute z-30 mt-1 w-full max-h-56 overflow-auto bg-white border border-dvivid-border rounded-input shadow-card-hover"
        >
          {filtered.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={name.toLowerCase() === value.trim().toLowerCase()}
              onMouseDown={e => {
                e.preventDefault();
                select(name);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${
                i === highlight ? "bg-dvivid-primary-light text-dvivid-primary" : "text-dvivid-text-primary"
              }`}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {open && showNotFound && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-dvivid-border rounded-input shadow-card-hover px-3 py-2">
          <p className="text-sm text-dvivid-text-secondary">
            University not found
            <span className="block text-xs text-dvivid-text-muted mt-0.5">
              It will be saved as entered: &quot;{value.trim()}&quot;
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
