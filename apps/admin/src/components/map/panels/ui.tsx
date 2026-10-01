"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
        {actions}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

const control = "h-8 w-full rounded-md border border-line bg-panel px-2 text-sm text-ink outline-none focus:border-accent";

/** A text box that saves when it loses focus or on Enter, and resets on Escape. */
export function TextInput({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit(value: string): void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  // A new value from the database replaces what's being typed.
  const [source, setSource] = useState(value);
  if (source !== value) {
    setSource(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      className={control}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(value: T): void;
  ariaLabel?: string;
}) {
  return (
    <select className={control} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type Tone = "default" | "accent" | "danger";
const tones: Record<Tone, string> = {
  default: "border border-line bg-panel text-ink hover:bg-ground",
  accent: "bg-accent text-white hover:opacity-90",
  danger: "border border-line bg-panel text-danger hover:bg-danger-soft",
};

export function Button({ tone = "default", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition disabled:opacity-40 ${tones[tone]} ${className}`}
    />
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted">{children}</p>;
}

/** "none" in selects stands for a null link. */
export const NONE = "none";
export const idValue = (id: number | null | undefined) => (id == null ? NONE : String(id));
export const valueId = (value: string) => (value === NONE ? null : Number(value));

export const label = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
