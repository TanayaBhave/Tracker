import type { ReactNode } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint" style={{ margin: '6px 2px 0' }}>{hint}</div>}
    </div>
  );
}

type Opt<T> = { value: T; label: string; tone?: 'signal' | 'calm' | 'alert' };

export function ChipSelect<T extends string>({
  value, onChange, options, allowClear = true,
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: Opt<T>[];
  allowClear?: boolean;
}) {
  return (
    <div className="choices">
      {options.map((o) => {
        const on = value === o.value;
        const tone = o.tone === 'calm' ? 'calm' : o.tone === 'alert' ? 'alert' : '';
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${tone} ${on ? 'on' : ''}`}
            onClick={() => onChange(on && allowClear ? undefined : o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChipMulti<T extends string>({
  values, onChange, options,
}: {
  values: T[];
  onChange: (v: T[]) => void;
  options: Opt<T>[];
}) {
  return (
    <div className="choices">
      {options.map((o) => {
        const on = values.includes(o.value);
        const tone = o.tone === 'calm' ? 'calm' : o.tone === 'alert' ? 'alert' : '';
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${tone} ${on ? 'on' : ''}`}
            onClick={() =>
              onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
