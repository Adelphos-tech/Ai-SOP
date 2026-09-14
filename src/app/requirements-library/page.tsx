"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface RequirementSetEntry {
  requirementSet: {
    id: string;
    intake: string;
    intakeYear: string;
    verificationStatus: string;
    aiPolicyStatus: string | null;
    contentHash?: string;
    verifiedAt?: string;
    lastCheckedAt?: string;
    createdAt: string;
    updatedAt: string;
  };
  program?: {
    id: string;
    programName: string;
    degree: string;
    department?: string;
  };
  institution?: {
    id: string;
    canonicalName: string;
    country?: string;
    officialDomain?: string;
  };
  writingRequirements: Array<{
    id: string;
    documentType: string;
    officialTitle: string;
    promptText: string;
    wordMin?: number;
    wordMax?: number;
    required: boolean;
  }>;
  sources: Array<{
    id: string;
    sourceUrl: string;
    officialDomain?: string;
    sourceTitle?: string;
    sourceScope: string;
    status: string;
  }>;
}

export default function RequirementsLibraryPage() {
  const [entries, setEntries] = useState<RequirementSetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    setLoading(true);
    try {
      const res = await fetch("/api/requirements/library");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.requirementSets || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  const filtered = query
    ? entries.filter(e =>
        e.institution?.canonicalName?.toLowerCase().includes(query.toLowerCase()) ||
        e.program?.programName?.toLowerCase().includes(query.toLowerCase()) ||
        e.requirementSet.intake?.toLowerCase().includes(query.toLowerCase()),
      )
    : entries;

  const statusColors: Record<string, string> = {
    VERIFIED: "bg-dvivid-success-light text-dvivid-success",
    PARTIALLY_VERIFIED: "bg-yellow-100 text-yellow-700",
    REVIEW_REQUIRED: "bg-orange-100 text-orange-700",
    UNKNOWN: "bg-gray-100 text-dvivid-text-secondary",
    CONFLICT: "bg-dvivid-error-light text-dvivid-error",
    PORTAL_ONLY_UNAVAILABLE: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dvivid-text-primary">Requirements Library</h1>
        <p className="text-sm text-dvivid-text-secondary mt-1">
          Browse verified university/program application requirements. These are reusable across student applications.
        </p>
      </div>

      <form onSubmit={e => { e.preventDefault(); }} className="mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by university, program, or intake..."
          className="w-full px-4 py-3 border border-dvivid-border rounded-input bg-white text-dvivid-text-primary placeholder-dvivid-text-tertiary focus:outline-none focus:ring-2 focus:ring-dvivid-blue/20 focus:border-dvivid-blue transition-colors text-sm"
        />
      </form>

      {loading && (
        <div className="text-center py-12 text-dvivid-text-secondary text-sm">Loading...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 bg-white border border-dvivid-border rounded-card">
          <p className="text-sm text-dvivid-text-secondary">No requirement sets found.</p>
          <p className="text-xs text-dvivid-text-tertiary mt-1">
            Requirements will appear here after discovery or manual verification.
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((entry, i) => {
            const rs = entry.requirementSet;
            const isExpanded = expanded === rs.id;
            return (
              <div
                key={rs.id}
                className="bg-white border border-dvivid-border rounded-card shadow-card overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : rs.id)}
                  className="w-full text-left p-5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-dvivid-text-primary">
                        {entry.institution?.canonicalName || "Unknown University"}
                      </h3>
                      <p className="text-sm text-dvivid-text-secondary mt-1">
                        {entry.program?.programName} · {entry.program?.degree}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-dvivid-text-tertiary">
                        <span>{rs.intake} {rs.intakeYear}</span>
                        {entry.institution?.country && <span>{entry.institution.country}</span>}
                        <span>{entry.writingRequirements.length} writing requirements</span>
                        <span>{entry.sources.length} sources</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${statusColors[rs.verificationStatus] || statusColors.UNKNOWN}`}>
                        {rs.verificationStatus.replace(/_/g, " ").toLowerCase()}
                      </span>
                      {rs.aiPolicyStatus && (
                        <span className="px-2.5 py-1 bg-gray-100 text-dvivid-text-secondary text-xs font-medium rounded-full">
                          {rs.aiPolicyStatus.replace(/_/g, " ").toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-dvivid-border-light p-5 space-y-4">
                    {/* Writing Requirements */}
                    <div>
                      <p className="text-xs font-medium text-dvivid-text-secondary uppercase tracking-wide mb-2">
                        Writing Requirements
                      </p>
                      {entry.writingRequirements.length === 0 ? (
                        <p className="text-xs text-dvivid-text-tertiary">None</p>
                      ) : (
                        <div className="space-y-2">
                          {entry.writingRequirements.map((wr, idx) => (
                            <div key={wr.id} className="border border-dvivid-border-light rounded-input p-3">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs text-dvivid-text-tertiary">{idx + 1}.</span>
                                <p className="text-sm font-medium text-dvivid-text-primary">{wr.officialTitle}</p>
                                <span className="text-xs text-dvivid-text-tertiary">{wr.documentType.replace(/_/g, " ").toLowerCase()}</span>
                                {wr.required && <span className="text-xs text-dvivid-error">required</span>}
                              </div>
                              <p className="text-xs text-dvivid-text-secondary whitespace-pre-wrap">
                                {wr.promptText.substring(0, 200)}{wr.promptText.length > 200 ? "..." : ""}
                              </p>
                              {(wr.wordMin || wr.wordMax) && (
                                <p className="text-xs text-dvivid-text-tertiary mt-1">
                                  Words: {wr.wordMin || 0}-{wr.wordMax || "∞"}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Sources */}
                    <div>
                      <p className="text-xs font-medium text-dvivid-text-secondary uppercase tracking-wide mb-2">
                        Official Sources
                      </p>
                      {entry.sources.length === 0 ? (
                        <p className="text-xs text-dvivid-text-tertiary">None</p>
                      ) : (
                        <div className="space-y-1">
                          {entry.sources.map((src) => (
                            <div key={src.id} className="text-xs">
                              <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-dvivid-blue hover:underline">
                                {src.sourceTitle || src.sourceUrl}
                              </a>
                              <span className="text-dvivid-text-tertiary ml-2">({src.sourceScope})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="text-xs text-dvivid-text-tertiary border-t border-dvivid-border-light pt-3">
                      {rs.verifiedAt && <span>Verified: {new Date(rs.verifiedAt).toLocaleDateString()}</span>}
                      {rs.lastCheckedAt && <span className="ml-3">Last checked: {new Date(rs.lastCheckedAt).toLocaleDateString()}</span>}
                      {rs.contentHash && <span className="ml-3">Hash: {rs.contentHash}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
