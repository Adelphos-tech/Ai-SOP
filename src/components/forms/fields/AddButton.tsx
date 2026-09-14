"use client";
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 border-2 border-dashed border-dvivid-blue text-dvivid-blue rounded-lg text-sm font-medium hover:bg-dvivid-blue-lighter transition-colors w-full"
    >
      + {label}
    </button>
  );
}
