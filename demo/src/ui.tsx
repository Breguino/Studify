// Pezzi comuni della demo, con le classi e le misure di Studify (raggi 18/12/14/999, controlli alti 44px).
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ onHero = false }: { onHero?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-extrabold text-[1.15rem] tracking-[-0.02em]">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" className={onHero ? "fill-hero-ink" : "fill-brand"} />
        <path d="M9.5 21l6.5-11.2 6.5 11.2z" fill="none" strokeWidth="2.6" strokeLinejoin="round" className={onHero ? "stroke-hero" : "stroke-brand-ink"} />
      </svg>
      Studify
    </span>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[.78rem] font-extrabold uppercase tracking-[.07em] text-muted", className)}>{children}</span>;
}

type Tone = "" | "brand" | "good" | "warn" | "bad";
const TONES: Record<Tone, string> = {
  "": "bg-surface-2 text-muted",
  brand: "bg-brand-soft text-brand",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
};
export function Pill({ children, tone = "" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn("inline-block rounded-full px-2.5 py-[3px] text-[.8rem] font-semibold", TONES[tone])}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="rounded-[5px] border border-b-2 border-line bg-surface-2 px-1.5 py-px font-mono text-[.75rem] font-normal text-muted">{children}</span>;
}

const STEPS = ["Descrivi l'esame", "Porta i materiali", "Controlla il modulo"];
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="Passi del primo esame" className="m-0 flex list-none flex-wrap items-center gap-x-7 gap-y-2 p-0">
      {STEPS.map((t, i) => {
        const n = i + 1;
        const done = n < current;
        const cur = n === current;
        return (
          <li key={t} aria-current={cur ? "step" : undefined} className={cn("flex items-center gap-2.5 font-semibold", cur ? "font-bold text-text" : "text-muted")}>
            <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-full text-[.85rem] font-extrabold",
              cur ? "bg-brand text-brand-ink" : done ? "bg-good-soft text-good" : "border-[1.5px] border-line-strong")}>
              {done ? <Check className="h-4 w-4" strokeWidth={3} aria-label="fatto" /> : n}
            </span>
            {t}
          </li>
        );
      })}
    </ol>
  );
}

/** Scelte a pulsante: un gruppo di radio vere, come nel modulo del nuovo esame. */
export function Choices<T extends string | number>({ name, legend, options, value, onChange, grid = false }: {
  name: string; legend: string; options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; grid?: boolean;
}) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[.92rem] font-semibold">{legend}</legend>
      <div className={cn(grid ? "grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2" : "flex flex-wrap gap-2")}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label key={String(o.value)} className={cn("inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-ctl border px-3.5 text-[.95rem] font-semibold transition-colors",
              grid && "items-start px-3 py-2.5",
              on ? "border-brand bg-brand-soft text-brand ring-1 ring-inset ring-brand" : "border-line-strong bg-surface hover:border-brand",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand/55")}>
              <input type="radio" name={name} className="m-0 accent-brand focus:outline-none" checked={on} onChange={() => onChange(o.value)} />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Bar({ value, tone = "brand", label, onHero = false, className }: { value: number; tone?: "brand" | "good"; label: string; onHero?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
      className={cn("h-2 overflow-hidden rounded-full", onHero ? "bg-hero-ink/15" : "bg-surface-2", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-300", onHero ? "bg-hero-ink" : tone === "good" ? "bg-good" : "bg-brand")} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export const btn = {
  base: "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-ctl border px-[18px] py-2 text-[1rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  primary: "border-brand bg-brand text-brand-ink font-bold hover:brightness-110",
  plain: "border-line-strong bg-surface text-text hover:border-brand",
  ghost: "border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-text",
  small: "min-h-[34px] rounded-[10px] px-3 py-1 text-[.88rem]",
};

export const phaseColor: Record<string, string> = {
  learn: "bg-brand/55",
  consolidate: "bg-brand",
  simulate: "bg-warn",
  light: "bg-good",
};
export const phaseColorHero: Record<string, string> = {
  learn: "bg-hero-learn",
  consolidate: "bg-hero-ink",
  simulate: "bg-hero-warn",
  light: "bg-hero-good",
};
