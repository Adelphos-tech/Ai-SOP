"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { calculateSections, calculateOverallCompletion } from "@/lib/completion/calculation";
import Image from "next/image";

export function TopBar() {
  const { profile, saveStatus } = useProfile();
  const sections = calculateSections(profile);
  const completion = calculateOverallCompletion(sections);

  return (
    <header className="bg-white border-b border-dvivid-border px-6 py-3 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <Image src="/logo_single.svg" alt="D-Vivid" width={36} height={36} />
        <div>
          <h1 className="text-lg font-bold text-dvivid-blue">D-Vivid SOP Portal</h1>
          <p className="text-xs text-gray-500">Student Intake & Profile</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-dvivid-blue rounded-full transition-all duration-500"
              style={{ width: `${completion}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-dvivid-blue min-w-[3rem]">{completion}%</span>
        </div>
        <div className="text-xs text-gray-500 min-w-[60px]">
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && <span className="text-green-600">Saved</span>}
        </div>
      </div>
    </header>
  );
}
