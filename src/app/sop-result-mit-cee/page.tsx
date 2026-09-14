/**
 * MIT CEE MEng — First Controlled Live Generation Result
 * Route: /sop-result-mit-cee
 */

import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";

const BASE = path.join(process.cwd(), "logs", "live-generations", "mit-cee-meng-fall-2027-001");

async function loadData() {
  const [finalText, quality, factReview, cost, usage] = await Promise.all([
    fs.readFile(path.join(BASE, "final-statement-of-objectives.txt"), "utf-8"),
    fs.readFile(path.join(BASE, "quality-review.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(BASE, "fact-review.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(BASE, "cost.json"), "utf-8").then(JSON.parse),
    fs.readFile(path.join(BASE, "usage.json"), "utf-8").then(JSON.parse),
  ]);
  return { finalText, quality, factReview, cost, usage };
}

export default async function MitCeeResultPage() {
  const data = await loadData();

  // Parse the final text into components
  const text = data.finalText;
  const aMatch = text.match(/A\. EXPERIENCE\n\n([\s\S]*?)\n\nB\. PURPOSE/);
  const bMatch = text.match(/B\. PURPOSE\n\n([\s\S]*)/);

  const componentA = aMatch ? aMatch[1].trim() : text;
  const componentB = bMatch ? bMatch[1].trim() : "";

  const q = data.quality;
  const f = data.factReview;
  const ca = f.componentA_review || {};
  const cb = f.componentB_review || {};

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900">MIT CEE — First Controlled Live Generation</h1>
          <p className="text-sm text-gray-500 mt-1">
            Master of Engineering in Civil and Environmental Engineering, Fall 2027
          </p>
        </div>

        {/* Compliance */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">APPLICATION COMPLIANCE</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Document Type" value={q.requirementCompliance?.documentType || "PASS"} />
            <Metric label="Response Components" value={q.requirementCompliance?.responseComponentCount || "PASS"} />
            <Metric label="Faculty Requirement" value={q.requirementCompliance?.facultyRequirement || "PASS"} />
            <Metric label="Page Limit" value={q.requirementCompliance?.pageLimit || "RENDER_VALIDATION_REQUIRED"} warn />
          </div>
        </div>

        {/* Statement of Objectives */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-2">STATEMENT OF OBJECTIVES</h2>

          {/* Component A */}
          <div className="mb-6">
            <h3 className="text-md font-medium text-blue-800 mb-2">A. EXPERIENCE</h3>
            <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed border-l-4 border-blue-200 pl-4">
              {componentA}
            </div>
            <p className="text-xs text-gray-400 mt-2">{componentA.split(/\s+/).length} words</p>
          </div>

          {/* Component B */}
          <div>
            <h3 className="text-md font-medium text-blue-800 mb-2">B. PURPOSE</h3>
            <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed border-l-4 border-blue-200 pl-4">
              {componentB}
            </div>
            <p className="text-xs text-gray-400 mt-2">{componentB.split(/\s+/).length} words</p>
          </div>
        </div>

        {/* Fact Review */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">FACT REVIEW</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Metric label="Invented Facts" value={(ca.invented_count || 0) + (cb.invented_count || 0)} warn={(ca.invented_count || 0) + (cb.invented_count || 0) > 0} />
            <Metric label="Altered Facts" value={(ca.altered_count || 0) + (cb.altered_count || 0)} />
            <Metric label="Interpretive Elaborations" value={(ca.elaboration_count || 0) + (cb.elaboration_count || 0)} />
            <Metric label="Supported Claims" value={(ca.supported_student_facts?.length || 0) + (cb.supported_student_facts?.length || 0)} />
          </div>
        </div>

        {/* Quality Scores */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">QUALITY SCORES</h2>
          <div className="grid grid-cols-3 gap-4">
            <Metric label="Component A" value={`${q.componentA_score}/10`} />
            <Metric label="Component B" value={`${q.componentB_score}/10`} />
            <Metric label="Overall" value={`${q.overall_score}/10`} />
          </div>
          {q.overall_feedback && (
            <p className="text-sm text-gray-600 mt-4 border-t pt-4">{q.overall_feedback}</p>
          )}
        </div>

        {/* Cost */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">COST</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Metric label="Stage Calls" value={data.usage.stages} />
            <Metric label="Duration" value={`${(data.usage.duration_ms / 1000).toFixed(1)}s`} />
            <Metric label="Total Words" value={data.usage.total_words} />
            <Metric label="Cost USD" value={`$${data.cost.estimatedApiCostUSD?.toFixed(4)}`} />
            <Metric label="Cost INR" value={`₹${data.cost.estimatedApiCostINR?.toFixed(2)}`} />
          </div>

          {/* Stage breakdown */}
          <details className="mt-4">
            <summary className="text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-800">
              Stage Breakdown
            </summary>
            <div className="mt-3 space-y-2">
              {data.cost.stages?.map((s: any, i: number) => (
                <div key={i} className="flex justify-between text-xs border-b pb-2">
                  <span className="font-medium">{s.stage}</span>
                  <span>{s.model} | {s.inputTokens}↑ {s.outputTokens}↓</span>
                  <span>${s.estimatedCostUsd?.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-sm font-semibold ${warn ? "text-amber-600" : "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
