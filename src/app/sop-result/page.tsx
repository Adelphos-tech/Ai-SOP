"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface StageCost {
  stage: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  estimatedCostInr: number;
  durationMs: number;
}

interface CostData {
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; };
  estimatedUsd: number;
  estimatedInr: number;
  exchangeRate: { pair: string; rate: number; source: string; retrievedAt: string; stale: boolean; };
  stages: StageCost[];
}

interface SopResult {
  status: string;
  finalSop: string;
  wordCount: number;
  model: string;
  duration: number;
  stages: number;
  factReview: { pass: boolean; unsupportedClaims: string[]; alteredClaims: string[]; ambiguousClaims: string[]; };
  qualityReview: { scores: any; majorIssues: string[]; recommendedEdits: string[]; };
  languageProfile: { level: string; tone: string; };
  cost: CostData | null;
}

export default function SopResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<SopResult | null>(null);
  const [editedSop, setEditedSop] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generationVersion, setGenerationVersion] = useState(1);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);

  useEffect(() => {
    const data = sessionStorage.getItem("sop-result");
    if (data) {
      const parsed = JSON.parse(data);
      setResult(parsed);
      setEditedSop(parsed.finalSop);
    } else {
      router.push("/fact-sheet");
    }
  }, [router]);

  if (!result) {
    return <div className="max-w-3xl mx-auto p-8"><p className="text-gray-500">Loading...</p></div>;
  }

  const currentSop = editing ? editedSop : result.finalSop;
  const currentWordCount = currentSop.trim().split(/\s+/).length;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSop);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = () => {
    if (confirm("Regenerate SOP? This will use the same approved fact sheet.")) {
      router.push("/fact-sheet");
    }
  };

  const avgQualityScore = result.qualityReview.scores
    ? Object.values(result.qualityReview.scores).reduce((a: number, b: any) => a + b, 0) / Object.keys(result.qualityReview.scores).length
    : 0;

  const cost = result.cost;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-dvivid-blue mb-1">Your SOP</h1>
        <p className="text-gray-500">Generation #{generationVersion} · Model: {result.model}</p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-dvivid-border p-4 shadow-sm">
          <p className="text-xs text-gray-500">Word Count</p>
          <p className="text-2xl font-bold text-dvivid-blue">{editing ? currentWordCount : result.wordCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-dvivid-border p-4 shadow-sm">
          <p className="text-xs text-gray-500">Fact Check</p>
          <p className={`text-lg font-bold ${result.factReview.pass ? "text-green-600" : "text-orange-500"}`}>
            {result.factReview.pass ? "✓ Passed" : "Review Required"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-dvivid-border p-4 shadow-sm">
          <p className="text-xs text-gray-500">Writing Quality</p>
          <p className="text-lg font-bold text-dvivid-blue">{avgQualityScore > 0 ? `${avgQualityScore.toFixed(1)}/10` : "N/A"}</p>
        </div>
        <div className="bg-white rounded-xl border border-dvivid-border p-4 shadow-sm">
          <p className="text-xs text-gray-500">Writing Level</p>
          <p className="text-sm font-bold text-dvivid-blue">{result.languageProfile.level}</p>
        </div>
      </div>

      {/* Fact Review Details */}
      {!result.factReview.pass && (result.factReview.unsupportedClaims.length > 0 || result.factReview.alteredClaims.length > 0) && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-orange-700">Fact Review Notes</h3>
          {result.factReview.unsupportedClaims.length > 0 && (
            <div>
              <p className="text-sm font-medium text-orange-700">Unsupported claims:</p>
              <ul className="text-sm text-orange-600 list-disc list-inside">
                {result.factReview.unsupportedClaims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {result.factReview.alteredClaims.length > 0 && (
            <div>
              <p className="text-sm font-medium text-orange-700">Altered claims:</p>
              <ul className="text-sm text-orange-600 list-disc list-inside">
                {result.factReview.alteredClaims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* SOP Text / Editor */}
      <div className="bg-white rounded-xl border border-dvivid-border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-700">Statement of Purpose</h3>
          <div className="flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50">Edit SOP</button>
            ) : (
              <button onClick={() => { setEditing(false); setEditedSop(result.finalSop); }} className="px-3 py-1.5 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            )}
            <button onClick={handleCopy} className="px-3 py-1.5 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50">
              {copied ? "✓ Copied" : "Copy SOP"}
            </button>
          </div>
        </div>
        {editing ? (
          <>
            <textarea
              value={editedSop}
              onChange={e => setEditedSop(e.target.value)}
              className="w-full min-h-[400px] p-4 border border-gray-300 rounded-lg text-sm font-serif resize-y focus:outline-none focus:ring-2 focus:ring-dvivid-blue"
            />
            <p className="text-xs text-gray-500 mt-2">Word count: {currentWordCount}</p>
          </>
        ) : (
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{currentSop}</p>
          </div>
        )}
      </div>

      {/* AI GENERATION COST PANEL (Development/Admin) */}
      {cost && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 text-gray-300">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">AI GENERATION COST (Development/Admin)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-500">Estimated OpenAI Cost</p>
              <p className="text-lg font-bold text-white">${cost.estimatedUsd.toFixed(4)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Estimated INR Cost</p>
              <p className="text-lg font-bold text-white">₹{cost.estimatedInr.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">USD → INR Rate</p>
              <p className="text-sm font-bold text-white">₹{cost.exchangeRate.rate.toFixed(2)} / $1</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pipeline Duration</p>
              <p className="text-sm font-bold text-white">{(result.duration / 1000).toFixed(1)} sec</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-xs">
            <div><span className="text-gray-500">Total Input Tokens:</span> <span className="text-gray-300 font-medium">{cost.usage.inputTokens.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Cached Input Tokens:</span> <span className="text-gray-300 font-medium">{cost.usage.cachedInputTokens.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Output Tokens:</span> <span className="text-gray-300 font-medium">{cost.usage.outputTokens.toLocaleString()}</span></div>
            <div><span className="text-gray-500">Total Tokens:</span> <span className="text-gray-300 font-medium">{cost.usage.totalTokens.toLocaleString()}</span></div>
          </div>

          <div className="text-xs text-gray-500 mb-3">
            FX Rate Updated: {new Date(cost.exchangeRate.retrievedAt).toLocaleString()} · Source: {cost.exchangeRate.source}
            {cost.exchangeRate.stale && <span className="text-yellow-500 ml-2">(STALE)</span>}
          </div>

          {/* Stage breakdown toggle */}
          <button
            onClick={() => setShowCostBreakdown(!showCostBreakdown)}
            className="text-xs text-blue-400 hover:underline"
          >
            {showCostBreakdown ? "▼ Hide" : "▶ View"} STAGE COST BREAKDOWN
          </button>

          {showCostBreakdown && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-2">Stage</th>
                    <th className="text-left">Model</th>
                    <th className="text-right">Input</th>
                    <th className="text-right">Cached</th>
                    <th className="text-right">Output</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">USD</th>
                    <th className="text-right">INR</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.stages.map((s, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      <td className="py-2 capitalize">{s.stage.replace(/([A-Z])/g, " $1").trim()}</td>
                      <td className="text-gray-400">{s.model}</td>
                      <td className="text-right">{s.inputTokens.toLocaleString()}</td>
                      <td className="text-right">{s.cachedInputTokens.toLocaleString()}</td>
                      <td className="text-right">{s.outputTokens.toLocaleString()}</td>
                      <td className="text-right">{(s.durationMs / 1000).toFixed(1)}s</td>
                      <td className="text-right text-green-400">${s.estimatedCostUsd.toFixed(4)}</td>
                      <td className="text-right text-green-400">₹{s.estimatedCostInr.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/fact-sheet" className="px-5 py-2 border border-dvivid-border rounded-lg text-sm hover:bg-gray-50">← Back to Fact Sheet</Link>
        <button onClick={handleRegenerate} className="px-5 py-2 bg-dvivid-blue text-white rounded-lg text-sm hover:bg-dvivid-blue-light">Regenerate SOP</button>
      </div>
    </div>
  );
}
