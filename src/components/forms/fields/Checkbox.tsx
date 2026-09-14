"use client";
export function Checkbox({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-dvivid-blue focus:ring-dvivid-blue"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}
