"use client";

// ============================================================
// AI Writing Studio — document-level Humanizer + AI Detection Report
// Humanizer: rewrite the whole saved document with Ryne, compare
// side by side, edit, apply and save as a new version.
// AI Detection Report: runs only on an explicit Run Report click.
// No paid call is ever made on page load. Demo report fixture is
// available via ?demo=1 in development only.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageContainer, Breadcrumb, SecondaryButton } from "@/components/ui";
import { useNavigationGuard } from "@/components/layout/NavigationGuardContext";
import HumanizerPanel from "@/components/writing-studio/HumanizerPanel";
import DetectionReportPanel, { type DetectionConfig } from "@/components/writing-studio/DetectionReportPanel";
import { Notice, TabBar, type StudioVersion } from "@/components/writing-studio/shared";
import type { ReportRun } from "@/lib/writing-review/report";

interface DocumentInfo { id: string; documentTitle: string }
interface Application { universityName: string; programName: string; degree: string }
type Studio = "humanizer" | "report";

export default function WritingStudioPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = params.studentId as string;
  const applicationId = params.applicationId as string;
  const documentId = params.documentId as string;
  const demo = searchParams.get("demo") === "1";
  const docHref = `/students/${studentId}/applications/${applicationId}/documents/${documentId}`;
  const apiUrl = `/api/application/writing-review?documentId=${documentId}&applicationId=${applicationId}&studentId=${studentId}`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [version, setVersion] = useState<StudioVersion | null>(null);
  const [config, setConfig] = useState<(DetectionConfig & { rewritePricing?: { balancedPer1k: number; titanPer1k: number } }) | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [studio, setStudio] = useState<Studio>("humanizer");
  const [dirty, setDirty] = useState(false);
  const [restorable, setRestorable] = useState<{ content: string; versionNumber: number } | null>(null);
  const [pageNotice, setPageNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [demoRun, setDemoRun] = useState<ReportRun | null>(null);
  const { registerGuard, unregisterGuard, checkGuard } = useNavigationGuard();

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to load"); return; }
      setDocument(data.document);
      setVersion(data.currentVersion);
      setProviderConfigured(!!data.rewriteProvider?.configured);
      setConfig(data.detectionConfig || null);
      const appRes = await fetch(`/api/application/list?applicationId=${applicationId}&studentId=${studentId}`);
      if (appRes.ok) setApplication((await appRes.json()).application);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, applicationId, studentId]);

  useEffect(() => { load(); }, [load]);

  // demo fixture — dev-only, clearly labeled, never production
  useEffect(() => {
    if (!demo || !version) return;
    import("@/lib/writing-review/fixture").then(m => {
      const built = m.buildDemoDetection(version.content, version.id);
      if (!built) return;
      setDemoRun({
        id: "demo", checkedAt: built.result.checkedAt, versionId: version.id, contentHash: version.contentHash,
        detectors: built.result.scores.filter(s => s.status === "SCORED").map(s => s.detector), detection: built.result,
      });
    });
  }, [demo, version]);

  // unsaved-draft protection
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    if (dirty) registerGuard(() => window.confirm("You have an unsaved humanized draft. Leave anyway?"));
    else unregisterGuard();
    return () => { window.removeEventListener("beforeunload", handler); unregisterGuard(); };
  }, [dirty, registerGuard, unregisterGuard]);

  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  async function saveVersion(content: string): Promise<boolean> {
    if (!version) return false;
    setPageNotice(null);
    const res = await fetch("/api/application/version", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, applicationId, documentId, content, baseVersionId: version.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setPageNotice({ tone: "error", text: data.error || "Failed to save" }); return false; }
    return true;
  }

  async function onSave(content: string) {
    if (!version) return false;
    const previous = { content: version.content, versionNumber: version.versionNumber };
    const ok = await saveVersion(content);
    if (ok) { setRestorable(previous); setDirty(false); await load(); }
    return ok;
  }

  async function onRestore() {
    if (!restorable) return;
    if (!window.confirm(`Restore the text of v${restorable.versionNumber}? It is saved as a new version; nothing is deleted.`)) return;
    if (await saveVersion(restorable.content)) {
      setRestorable(null);
      setPageNotice({ tone: "success", text: `Restored the text of v${restorable.versionNumber} as a new version.` });
      await load();
    }
  }

  async function handleExport() {
    if (!version) return;
    if (dirty && !window.confirm("The humanized draft is not saved. Export the last saved version anyway?")) return;
    setExporting(true);
    try {
      const res = await fetch("/api/application/document/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, applicationId, documentId, versionId: version.id, format: "PDF", mode: "PREVIEW" }),
      });
      if (!res.ok) { setPageNotice({ tone: "error", text: (await res.json()).error || "Export failed" }); return; }
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "export";
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url; a.download = name; a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setPageNotice({ tone: "error", text: e?.message || "Export failed" });
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <PageContainer><div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading AI Writing Studio…</div></PageContainer>;
  }
  if (error || !document) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <p className="text-sm text-dvivid-error">{error || "Document not found"}</p>
          <Link href={`/students/${studentId}/applications/${applicationId}`} className="mt-4 inline-block text-sm text-dvivid-primary hover:underline">← Back to application</Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Breadcrumb items={[
        { label: "Students", href: "/students" },
        { label: "Application", href: `/students/${studentId}/applications/${applicationId}` },
        { label: document.documentTitle, href: docHref },
        { label: "AI Writing Studio" },
      ]} onNavigate={checkGuard ? href => checkGuard(href) : undefined} />

      <header className="bg-white border border-dvivid-border rounded-card shadow-card px-4 sm:px-7 py-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-page-title text-dvivid-text-primary">AI Writing Studio</h1>
            <p className="text-sm text-dvivid-text-secondary mt-1">
              Humanize your {document.documentTitle} with Ryne AI, and run a detailed AI detection report when you need one.
            </p>
            {application && (
              <p className="text-xs text-dvivid-text-muted mt-1 truncate">{application.universityName} · {application.degree} {application.programName}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={handleExport} disabled={exporting || !version} className="!px-4 !py-2">
              {exporting ? "Exporting…" : "Export"}
            </SecondaryButton>
            <SecondaryButton onClick={() => { if (checkGuard ? checkGuard(docHref) : true) router.push(docHref); }} className="!px-4 !py-2">
              Return to Document
            </SecondaryButton>
          </div>
        </div>
        <TabBar label="Studio" value={studio} onChange={setStudio} className="mt-4 w-full sm:w-auto"
          tabs={[{ id: "humanizer", label: "Humanizer" }, { id: "report", label: "AI Detection Report" }]} />
      </header>

      {pageNotice && <div className="mb-4"><Notice tone={pageNotice.tone}>{pageNotice.text}</Notice></div>}

      {!version ? (
        <div className="bg-white border border-dvivid-border rounded-card shadow-card p-8 text-center text-sm text-dvivid-text-secondary">
          This document has no generated version yet.
        </div>
      ) : (
        <>
          <div hidden={studio !== "humanizer"}>
            <HumanizerPanel
              version={version}
              configured={providerConfigured}
              pricing={config?.rewritePricing ?? { balancedPer1k: 0.08, titanPer1k: 0.5 }}
              apiUrl={apiUrl}
              documentId={documentId}
              detection={config ? { runnable: config.runnable ?? [], configured: config.configured } : null}
              onSave={onSave}
              onDirtyChange={onDirtyChange}
              restorable={restorable}
              onRestore={onRestore}
              onVersionDrift={load}
            />
          </div>
          <div hidden={studio !== "report"}>
            <DetectionReportPanel version={version} config={config} apiUrl={apiUrl} documentId={documentId}
              hasUnsavedRewrite={dirty} demoRun={demoRun}
              onSave={onSave} onOpenHumanizer={() => setStudio("humanizer")} onDirtyChange={onDirtyChange} />
          </div>
        </>
      )}
    </PageContainer>
  );
}
