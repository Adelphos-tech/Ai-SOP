/**
 * @file FacultyAlignmentPanel.tsx
 * @description
 * Shows proposed MIT CEE faculty alignments to the student.
 * Student must explicitly approve or reject each proposal.
 *
 * Only PROPOSED alignments are shown. Once approved/rejected,
 * the status is locked and displayed but cannot be changed.
 */

"use client";

import React, { useState, useEffect } from "react";

interface FacultyAlignmentProposal {
  alignmentId: string;
  facultyName: string;
  officialTitle: string;
  officialProfileUrl: string;
  verifiedFacultyResearch: string;
  alignmentReason: string;
  relevanceScore: number;
  status: "PROPOSED" | "STUDENT_APPROVED" | "REJECTED";
}

interface FacultyAlignmentGateResult {
  gateStatus: string;
  facultyProposals: {
    total: number;
    proposed: number;
    studentApproved: number;
    rejected: number;
    proposals: FacultyAlignmentProposal[];
  };
  generationContractGate: {
    facultyRequirementSatisfied: boolean;
    readyForGeneration: boolean;
    blockingReason: string | null;
  };
}

export default function FacultyAlignmentPanel() {
  const [gate, setGate] = useState<FacultyAlignmentGateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    // In production this would fetch from the API
    // For now, load from the artifact
    fetch("/logs/requirements/ai-permitted-live-test/faculty-alignment-gate-result.json")
      .then(r => r.json())
      .then(data => {
        setGate(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleAction = async (alignmentId: string, action: "approve" | "reject") => {
    setActionLoading(alignmentId);
    try {
      const res = await fetch("/api/application/faculty-alignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationIdentity: {
            university: "Massachusetts Institute of Technology",
            department: "Civil and Environmental Engineering",
            program: "Master of Engineering in Civil and Environmental Engineering",
            degree: "MEng",
            intake: "Fall 2027",
          },
          alignmentId,
          action,
        }),
      });
      const data = await res.json();
      if (data.success && gate) {
        // Update local state
        const updated = { ...gate };
        const p = updated.facultyProposals.proposals.find(
          (x) => x.alignmentId === alignmentId
        );
        if (p) {
          p.status = action === "approve" ? "STUDENT_APPROVED" : "REJECTED";
        }
        updated.facultyProposals.proposed =
          updated.facultyProposals.proposals.filter(x => x.status === "PROPOSED").length;
        updated.facultyProposals.studentApproved =
          updated.facultyProposals.proposals.filter(x => x.status === "STUDENT_APPROVED").length;
        updated.facultyProposals.rejected =
          updated.facultyProposals.proposals.filter(x => x.status === "REJECTED").length;

        if (updated.facultyProposals.studentApproved > 0) {
          updated.generationContractGate.facultyRequirementSatisfied = true;
          updated.generationContractGate.readyForGeneration = true;
          updated.generationContractGate.blockingReason = null;
          updated.gateStatus = "CLEARED";
        }

        setGate(updated);
      }
    } catch (e) {
      console.error("Faculty alignment action failed:", e);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Loading faculty alignment data…</div>;
  }

  if (!gate) {
    return <div className="text-sm text-gray-500">No faculty alignment data available.</div>;
  }

  const proposals = gate.facultyProposals.proposals;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border-b pb-3">
        <h3 className="text-lg font-semibold">MIT CEE Faculty Alignment</h3>
        <p className="text-sm text-gray-600 mt-1">
          The MIT CEE Statement of Objectives requires you to name faculty members
          whose research aligns with your interests. Review the proposed alignments
          below and confirm only those that genuinely reflect your interests.
        </p>
      </div>

      {/* Gate status */}
      <div className={`rounded-lg p-3 text-sm font-medium ${
        gate.gateStatus === "CLEARED"
          ? "bg-green-50 text-green-800 border border-green-200"
          : "bg-amber-50 text-amber-800 border border-amber-200"
      }`}>
        {gate.gateStatus === "CLEARED"
          ? "Faculty alignment approved. Generation is ready."
          : "Faculty alignment required. Approve at least one faculty alignment to proceed."}
        {gate.generationContractGate.blockingReason && (
          <div className="mt-1 text-xs opacity-75">
            {gate.generationContractGate.blockingReason}
          </div>
        )}
      </div>

      {/* Proposals */}
      <div className="space-y-3">
        {proposals.map((p) => (
          <div
            key={p.alignmentId}
            className={`border rounded-lg p-4 ${
              p.status === "STUDENT_APPROVED"
                ? "border-green-300 bg-green-50"
                : p.status === "REJECTED"
                ? "border-gray-200 bg-gray-50 opacity-60"
                : "border-blue-200 bg-blue-50/30"
            }`}
          >
            {/* Faculty header */}
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-semibold text-sm">{p.facultyName}</h4>
                <p className="text-xs text-gray-500">{p.officialTitle}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                p.status === "STUDENT_APPROVED"
                  ? "bg-green-100 text-green-700"
                  : p.status === "REJECTED"
                  ? "bg-gray-100 text-gray-500"
                  : "bg-blue-100 text-blue-700"
              }`}>
                {p.status === "STUDENT_APPROVED" ? "Approved" : p.status === "REJECTED" ? "Not relevant" : "Proposed"}
              </span>
            </div>

            {/* Research areas */}
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-600 mb-1">Official Research Areas:</p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {p.verifiedFacultyResearch}
              </p>
            </div>

            {/* Alignment reason */}
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-600 mb-1">Why this may align with your profile:</p>
              <p className="text-xs text-gray-700 leading-relaxed">
                {p.alignmentReason}
              </p>
            </div>

            {/* Relevance score */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-500">Relevance:</span>
              <div className="flex-1 bg-gray-200 rounded-full h-1.5 max-w-[120px]">
                <div
                  className="bg-blue-500 h-1.5 rounded-full"
                  style={{ width: `${p.relevanceScore}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-700">{p.relevanceScore}%</span>
            </div>

            {/* Official source link */}
            <div className="mt-2">
              <a
                href={p.officialProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                View Official MIT Profile →
              </a>
            </div>

            {/* Action buttons */}
            {p.status === "PROPOSED" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleAction(p.alignmentId, "approve")}
                  disabled={actionLoading === p.alignmentId}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === p.alignmentId ? "Processing…" : "Approve Alignment"}
                </button>
                <button
                  onClick={() => handleAction(p.alignmentId, "reject")}
                  disabled={actionLoading === p.alignmentId}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                >
                  {actionLoading === p.alignmentId ? "Processing…" : "Not Relevant"}
                </button>
              </div>
            )}

            {p.status === "STUDENT_APPROVED" && (
              <div className="mt-2 text-xs text-green-700 font-medium">
                This alignment has been approved and will be included in your application.
              </div>
            )}

            {p.status === "REJECTED" && (
              <div className="mt-2 text-xs text-gray-500">
                This alignment has been marked as not relevant and will not be used.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div className="text-xs text-gray-500 border-t pt-3">
        <p>
          These are suggested alignments based on your approved profile. Confirm only
          if they genuinely reflect your research interests. Approved alignments will
          be used to address the MIT CEE Statement of Objectives prompt.
        </p>
      </div>
    </div>
  );
}
