"use client";

export function FormField({
  label,
  required,
  children,
  helper,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  helper?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-dvivid-text-primary mb-1.5">
        {label}
        {required && <span className="text-dvivid-error ml-0.5">*</span>}
      </label>
      {children}
      {helper && <p className="text-sm text-dvivid-text-muted mt-1.5">{helper}</p>}
    </div>
  );
}

export const inputClass =
  "w-full px-4 py-3 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-muted focus:outline-none focus:ring-2 focus:ring-dvivid-primary/12 focus:border-dvivid-primary transition-colors text-sm";

export function TextInput({
  value,
  onChange,
  placeholder,
  className = "",
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClass + " " + className}
    />
  );
}

export function SelectField({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={inputClass + " " + className}
    >
      {children}
    </select>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  className = "",
  rows = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={inputClass + " " + className}
    />
  );
}
