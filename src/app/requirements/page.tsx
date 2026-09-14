"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/persistence/ProfileContext";

interface SourceRecord {
  sourceId: string;
  sourceClass: string;
  title: string;
  officialOrganization: string;
  officialDomain: string;
  url: string;
  retrievedAt: string;
  status: string;
  priority: string;
}

interface DocumentRequirement {
  documentType: string;
  documentTypeLabel: string;
  required: boolean;
  officialPrompt: { rawText: string | null; status: string };
  wordLimit: { min: number | null; max: number | null; status: string };
  characterLimit: { min: number | null; max: number | null; status: string };
  requiredTopics: any[];
  formatInstructions: any[];
}

interface VerifiedApplicationBrief {
  applicationIdentity: {
    country: string;
    university: string;
    program: string;
    degreeLevel: string;
    intake: string;
    intakeYear: string;
  };
  documents: DocumentRequirement[];
  sources: SourceRecord[];
  verification: {
    status: string;
    verifiedAt: string;
    conflicts: any[];
    blockingIssues: any[];
  };
}

const STATUS_ICONS: Record<string, string> = {
  VERIFIED: "✓",
  UNKNOWN: "!",
  NOT_SPECIFIED_BY_OFFICIAL_SOURCE: "—",
  PORTAL_ONLY_UNAVAILABLE: "🔒",
  CONFLICT: "⚠",
  REVIEW_REQUIRED: "?",
  BLOCKED: "✗",
  PARTIALLY_VERIFIED: "~",
  UNVERIFIED: "!",
};

const STATUS_COLORS: Record<string, string> = {
  VERIFIED: "text-green-600",
  UNKNOWN: "text-orange-500",
  NOT_SPECIFIED_BY_OFFICIAL_SOURCE: "text-gray-500",
  PORTAL_ONLY_UNAVAILABLE: "text-blue-500",
  CONFLICT: "text-red-500",
  REVIEW_REQUIRED: "text-yellow-500",
  BLOCKED: "text-red-600",
  PARTIALLY_VERIFIED: "text-yellow-500",
  UNVERIFIED: "text-orange-500",
};

function StatusBadge({ status }: { status: string }) {
  const icon = STATUS_ICONS[status] || "?";
  const color = STATUS_COLORS[status] || "text-gray-500";
  const labels: Record<string, string> = {
    VERIFIED: "Verified",
    UNKNOWN: "Unknown",
    NOT_SPECIFIED_BY_OFFICIAL_SOURCE: "Not specified by official source",
    PORTAL_ONLY_UNAVAILABLE: "Portal only — unavailable publicly",
    CONFLICT: "Conflict between sources",
    REVIEW_REQUIRED: "Review required",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
      <span className="text-lg">{icon}</span>
      {labels[status] || status}
    </span>
  );
}

export default function RequirementsPage() {
  const { profile, updateProfile } = useProfile();
  const router = useRouter();
  const [brief, setBrief] = useState<VerifiedApplicationBrief | null>(null);
  const [aiPolicy, setAiPolicy] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const app = profile.application;
  const hasApplicationInfo = app.targetCountry && app.targetUniversity && app.targetProgram;

  const handleResolve = async () => {
    setLoading(true);
    setError("");
    setBrief(null);
    setConfirmed(false);

    try {
      const response = await fetch("/api/requirements/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          university: app.targetUniversity,
          program: app.targetProgram,
          degree: app.degreeLevel,
          intake: app.intake,
          country: app.targetCountry,
          hintRequirementsUrl: app.officialRequirementsUrl || undefined,
          hintAiPolicyUrl: app.officialAiPolicyUrl || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Discovery failed");
        setLoading(false);
        return;
      }

      // Discovery result has context.brief and context.aiPolicy
      const ctx = data.context;
      if (ctx) {
        setBrief(ctx.brief);
        setAiPolicy(ctx.aiPolicy || null);

        // Store in sessionStorage for UI cache (NOT authoritative)
        sessionStorage.setItem("requirements-brief", JSON.stringify(ctx.brief));
        if (ctx.aiPolicy) {
          sessionStorage.setItem("ai-usage-policy", JSON.stringify(ctx.aiPolicy));
        }
        sessionStorage.setItem("application-id", ctx.applicationId);
      } else {
        // No context — discovery failed
        if (data.unresolvedFields && data.unresolvedFields.length > 0) {
          setError(`Discovery incomplete: ${data.unresolvedFields.map((f: any) => f.fieldName).join(", ")}`);
        }
      }
    } catch (err: any) {
      setError("Network error during requirements discovery");
    }
    setLoading(false);
  };

  const handleConfirm = () => {
    setConfirmed(true);
    // Store confirmation
    sessionStorage.setItem("requirements-confirmed", "true");
    updateProfile(p => ({
      ...p,
      factSheetApproval: {
        ...p.factSheetApproval,
        requirementsConfirmed: true,
      },
    }));
  };

  const isBlocked = brief?.verification?.status === "BLOCKED" || brief?.verification?.status === "CONFLICT";
  const hasBlockingIssues = brief?.verification?.blockingIssues?.some((i: any) => i.severity === "BLOCK");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dvivid-blue mb-1">Application Requirements</h1>
        <p className="text-gray-500">Official requirements verified from university and government sources only.</p>
      </div>

      {/* Application Identity */}
      <div className="bg-white rounded-xl border border-dvivid-border p-5 shadow-sm">
        <h3 className="font-semibold text-gray-700 mb-3">Application Details</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500">Country</p>
            <p className="text-sm font-medium">{app.targetCountry || "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">University</p>
            <p className="text-sm font-medium">{app.targetUniversity || "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Program</p>
            <p className="text-sm font-medium">{app.targetProgram || "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Degree Level</p>
            <p className="text-sm font-medium">{app.degreeLevel || "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Intake</p>
            <p className="text-sm font-medium">{app.intake || "Not set"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Intake Year</p>
            <p className="text-sm font-medium">{app.intakeYear || "Not set"}</p>
          </div>
        </div>

        {!hasApplicationInfo && (
          <div className="mt-4 bg-orange-50 border border-orange-300 rounded-lg p-3 text-sm text-orange-700">
            Please complete the application details first.
            <Link href="/application" className="ml-2 underline">Go to Application →</Link>
          </div>
        )}

        {hasApplicationInfo && (
          <button
            onClick={handleResolve}
            disabled={loading}
            className="mt-4 px-5 py-2.5 bg-dvivid-blue text-white rounded-lg text-sm font-medium hover:bg-dvivid-blue-light disabled:opacity-50"
          >
            {loading ? "Discovering official requirements..." : brief ? "Re-discover Requirements" : "Discover Official Requirements"}
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="bg-blue-50 border border-blue-300 rounded-xl p-4">
          <p className="text-sm font-medium text-blue-700">Discovering official application requirements...</p>
          <p className="text-xs text-blue-600 mt-1">This searches and verifies official university sources only.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Blocking notice */}
      {brief && (isBlocked || hasBlockingIssues) && (
        <div className="bg-red-50 border-2 border-red-400 rounded-xl p-5">
          <h3 className="font-semibold text-red-700 mb-2">Official application requirements could not be verified.</h3>
          <p className="text-sm text-red-600 mb-3">SOP generation is unavailable until official requirements are verified.</p>
          {brief.verification.blockingIssues.map((issue: any, i: number) => (
            <div key={i} className="text-sm text-red-600 flex items-start gap-2">
              <span className="font-bold">{issue.severity === "BLOCK" ? "✗" : "⚠"}</span>
              <span>{issue.issue}</span>
            </div>
          ))}
          <p className="text-xs text-red-500 mt-3">There is no bypass option. Requirements must be verified from official sources.</p>
        </div>
      )}

      {/* Verified brief display */}
      {brief && !isBlocked && !hasBlockingIssues && (
        <>
          {/* Verification status */}
          <div className={`rounded-xl border p-4 ${brief.verification.status === "VERIFIED" ? "bg-green-50 border-green-300" : "bg-yellow-50 border-yellow-300"}`}>
            <p className="text-sm font-medium">
              Verification Status: <span className={STATUS_COLORS[brief.verification.status] || "text-gray-500"}>{brief.verification.status}</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">Verified at: {new Date(brief.verification.verifiedAt).toLocaleString()}</p>
          </div>

          {/* Document requirements */}
          {brief.documents.map((doc, i) => (
            <div key={i} className="bg-white rounded-xl border border-dvivid-border p-5 shadow-sm space-y-3">
              <h3 className="font-semibold text-gray-700">{doc.documentTypeLabel}</h3>

              {/* Official prompt */}
              <div>
                <p className="text-xs text-gray-500 mb-1">Official SOP/Essay Question</p>
                {doc.officialPrompt.status === "VERIFIED" && doc.officialPrompt.rawText ? (
                  <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm italic">{doc.officialPrompt.rawText}</div>
                ) : (
                  <StatusBadge status={doc.officialPrompt.status} />
                )}
              </div>

              {/* Word limit */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Word Limit</span>
                {doc.wordLimit.status === "VERIFIED" ? (
                  <span className="text-sm font-medium">
                    {doc.wordLimit.min ? `${doc.wordLimit.min}-` : ""}{doc.wordLimit.max} words
                  </span>
                ) : (
                  <StatusBadge status={doc.wordLimit.status} />
                )}
              </div>

              {/* Character limit */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Character Limit</span>
                {doc.characterLimit.status === "VERIFIED" ? (
                  <span className="text-sm font-medium">
                    {doc.characterLimit.min ? `${doc.characterLimit.min}-` : ""}{doc.characterLimit.max} characters
                  </span>
                ) : (
                  <StatusBadge status={doc.characterLimit.status} />
                )}
              </div>

              {/* Required topics */}
              {doc.requiredTopics.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Required Topics</p>
                  <ul className="text-sm list-disc list-inside">
                    {doc.requiredTopics.map((t: any, j: number) => <li key={j}>{t.value}</li>)}
                  </ul>
                </div>
              )}

              {/* Format instructions */}
              {doc.formatInstructions.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Format Instructions</p>
                  <ul className="text-sm list-disc list-inside">
                    {doc.formatInstructions.map((f: any, j: number) => <li key={j}>{f.value}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {/* Sources */}
          {brief.sources.length > 0 && (
            <div className="bg-white rounded-xl border border-dvivid-border p-5 shadow-sm">
              <button
                onClick={() => setShowSources(!showSources)}
                className="text-sm font-semibold text-dvivid-blue hover:underline"
              >
                {showSources ? "▼ Hide" : "▶ View"} Official Sources ({brief.sources.length})
              </button>
              {showSources && (
                <div className="mt-3 space-y-3">
                  {brief.sources.map((src, i) => (
                    <div key={i} className="border-l-2 border-dvivid-blue pl-3">
                      <p className="text-sm font-medium">{src.title}</p>
                      <p className="text-xs text-gray-500">{src.officialOrganization} — {src.officialDomain}</p>
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-xs text-dvivid-blue hover:underline">{src.url}</a>
                      <p className="text-xs text-gray-400 mt-1">
                        Retrieved: {new Date(src.retrievedAt).toLocaleDateString()} · Status: {src.status} · Priority: {src.priority}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Policy display */}
          {aiPolicy && (
            <div className="bg-white rounded-xl border border-dvivid-border p-5 shadow-sm space-y-3">
              <h3 className="font-semibold text-gray-700">AI Usage Policy</h3>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Policy Status</span>
                <span className={`text-sm font-medium ${
                  aiPolicy.status === "AI_GENERATION_ALLOWED" ? "text-green-600" :
                  aiPolicy.status === "AI_GENERATION_PROHIBITED" ? "text-red-600" :
                  aiPolicy.status === "AI_POLICY_CONFLICT" ? "text-red-500" :
                  "text-orange-500"
                }`}>
                  {aiPolicy.status === "AI_GENERATION_ALLOWED" ? "AI generation allowed" :
                   aiPolicy.status === "AI_GENERATION_PROHIBITED" ? "AI generation prohibited" :
                   aiPolicy.status === "AI_ASSISTANCE_RESTRICTED" ? "AI assistance restricted" :
                   aiPolicy.status === "AI_POLICY_CONFLICT" ? "Conflicting policies detected" :
                   aiPolicy.status === "AI_POLICY_NOT_FOUND" ? "AI policy not found" :
                   aiPolicy.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Generation Permitted</span>
                <span className={`text-sm font-medium ${aiPolicy.generationAllowed ? "text-green-600" : "text-red-600"}`}>
                  {aiPolicy.generationAllowed ? "Yes" : "No"}
                </span>
              </div>
              {aiPolicy.sources && aiPolicy.sources.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Policy Sources ({aiPolicy.sources.length})</p>
                  {aiPolicy.sources.map((src: any, i: number) => (
                    <div key={i} className="border-l-2 border-dvivid-blue pl-3 mb-2">
                      <p className="text-xs font-medium">{src.title || src.url}</p>
                      <p className="text-xs text-gray-500">Domain verified: {src.domainVerified ? "Yes" : "No"}</p>
                      {src.url && <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-xs text-dvivid-blue hover:underline">{src.url}</a>}
                    </div>
                  ))}
                </div>
              )}
              {aiPolicy.blockingReasons && aiPolicy.blockingReasons.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  {aiPolicy.blockingReasons.map((r: string, i: number) => (
                    <p key={i} className="text-xs text-red-600">{r}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Confirmation */}
          <div className="bg-white rounded-xl border-2 border-dvivid-border p-6 shadow-sm space-y-4">
            <h3 className="text-lg font-semibold text-gray-700">Requirement Confirmation</h3>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300"
              />
              <span className="text-sm">I have reviewed the official application requirements.</span>
            </label>
            <button
              onClick={handleConfirm}
              disabled={!confirmed}
              className={`px-6 py-3 rounded-lg text-sm font-medium w-full transition-colors ${
                confirmed ? "bg-dvivid-blue text-white hover:bg-dvivid-blue-light" : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Confirm Application Requirements
            </button>
            {confirmed && (
              <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-sm text-green-700 font-medium">
                ✓ Requirements confirmed. You can proceed to the Fact Sheet.
              </div>
            )}
          </div>
        </>
      )}

      {/* Navigation */}
      <div className="flex flex-wrap gap-3">
        <Link href="/application" className="px-5 py-2 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50">← Application Details</Link>
        {confirmed && !isBlocked && !hasBlockingIssues && (
          <Link href="/fact-sheet" className="px-5 py-2 bg-dvivid-blue text-white rounded-lg text-sm hover:bg-dvivid-blue-light">Proceed to Fact Sheet →</Link>
        )}
      </div>
    </div>
  );
}
