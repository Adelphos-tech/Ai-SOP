"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { calculateSections } from "@/lib/completion/calculation";
import { SectionStatus } from "@/types";

const statusIcons: Record<SectionStatus, string> = {
  "complete": "✓",
  "in-progress": "●",
  "missing": "!",
  "not-started": "○",
};

const statusColors: Record<SectionStatus, string> = {
  "complete": "text-green-600",
  "in-progress": "text-blue-500",
  "missing": "text-orange-500",
  "not-started": "text-gray-400",
};

const navItems = [
  { id: "", label: "Dashboard" },
  { id: "students", label: "Students" },
  { id: "app-setup", label: "Application Setup" },
  { id: "requirements-library", label: "Requirements Library" },
  { id: "personal", label: "Personal Details" },
  { id: "education", label: "Education" },
  { id: "english", label: "English Proficiency" },
  { id: "experience", label: "Experience" },
  { id: "projects", label: "Projects & Research" },
  { id: "achievements", label: "Achievements" },
  { id: "application", label: "Course & University" },
  { id: "career", label: "Career Goals" },
  { id: "personal-story", label: "Personal Story" },
  { id: "preferences", label: "SOP Preferences" },
  { id: "documents", label: "Documents" },
  { id: "fact-sheet", label: "Review Fact Sheet" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { profile } = useProfile();
  const sections = calculateSections(profile);
  const sectionMap = new Map(sections.map(s => [s.id, s]));

  return (
    <aside className="w-64 bg-white border-r border-dvivid-border min-h-[calc(100vh-65px)] py-4">
      <nav className="flex flex-col gap-1 px-3">
        {navItems.map(item => {
          const isActive = pathname === `/${item.id}`;
          const section = sectionMap.get(item.id);
          const status = section?.status;
          return (
            <Link
              key={item.id}
              href={`/${item.id}`}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-dvivid-blue text-white font-semibold"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <span>{item.label}</span>
              {status && (
                <span className={`text-xs ${isActive ? "text-white" : statusColors[status]}`}>
                  {statusIcons[status]}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
