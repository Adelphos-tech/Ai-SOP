"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { hrefWithStudent } from "@/lib/navigation/student-nav";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";

const sectionOrder = [
  "personal", "education", "english", "experience", "projects",
  "achievements", "application", "career", "personal-story",
  "preferences", "documents", "fact-sheet",
];

function FormShellInner({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId");
  const current = pathname.replace("/", "");
  const idx = sectionOrder.indexOf(current);
  const prev = idx > 0 ? sectionOrder[idx - 1] : null;
  const next = idx < sectionOrder.length - 1 ? sectionOrder[idx + 1] : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 px-4 md:px-8 py-8">
      <WorkflowStepper />
      {studentId && (
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/students/${studentId}`} className="text-dvivid-text-secondary hover:text-dvivid-blue transition-colors">
            ← Back to Student Workspace
          </Link>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold text-dvivid-blue mb-1">{title}</h1>
        <p className="text-gray-500">{description}</p>
      </div>
      <div className="bg-white rounded-xl border border-dvivid-border p-6 shadow-sm space-y-5">
        {children}
      </div>
      <div className="flex justify-between">
        {prev ? (
          <Link href={hrefWithStudent(`/${prev}`, studentId)} className="px-5 py-2 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50 transition-colors">
            ← Previous
          </Link>
        ) : <div />}
        {next ? (
          <Link href={hrefWithStudent(`/${next}`, studentId)} className="px-5 py-2 bg-dvivid-blue text-white rounded-lg text-sm hover:bg-dvivid-blue-light transition-colors">
            Save & Continue →
          </Link>
        ) : <div />}
      </div>
    </div>
  );
}

export function FormShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto"><div className="h-8" /></div>}>
      <FormShellInner title={title} description={description}>
        {children}
      </FormShellInner>
    </Suspense>
  );
}
