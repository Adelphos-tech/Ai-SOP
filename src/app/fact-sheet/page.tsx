"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { calculateSections, calculateOverallCompletion } from "@/lib/completion/calculation";
import { Checkbox } from "@/components/forms/fields/Checkbox";
import { PageContainer, PageHeader, SectionCard, PrimaryButton } from "@/components/ui";
import { WorkflowStepper } from "@/components/ui/WorkflowStepper";

function FactRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-dvivid-text-secondary">{label}</span>
      <span className="text-dvivid-text-primary font-medium text-right">{value}</span>
    </div>
  );
}

function FactSectionCard({ title, editLink, completed, children }: { title: string; editLink: string; completed: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-dvivid-border rounded-card shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            completed ? "bg-dvivid-success-light text-dvivid-success" : "bg-gray-100 text-dvivid-text-muted"
          }`}>
            {completed ? "✓" : "○"}
          </span>
          <h3 className="text-card-title text-dvivid-text-primary">{title}</h3>
        </div>
        <Link href={editLink} className="text-sm text-dvivid-primary hover:underline font-medium">Edit</Link>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const stageLabels = [
  "Preparing your document",
  "Drafting",
  "Reviewing quality",
  "Adjusting language",
  "Finalizing",
  "Verifying facts",
];

export default function FactSheetPage() {
  const { profile, updateProfile } = useProfile();
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const sections = calculateSections(profile);
  const completion = calculateOverallCompletion(sections);
  const approved = profile.factSheetApproval.approved;
  const ready = completion === 100;

  const toggleApproval = (checked: boolean) => {
    updateProfile(p => ({ ...p, factSheetApproval: { approved: checked, approvedAt: checked ? new Date().toISOString() : "" } }));
  };

  const handleGenerate = async () => {
    if (!approved) return;
    setGenerating(true);
    setError("");
    setStage(0);

    const stageInterval = setInterval(() => {
      setStage(s => Math.min(s + 1, stageLabels.length - 1));
    }, 3000);

    try {
      const response = await fetch("/api/sop/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      clearInterval(stageInterval);
      setStage(stageLabels.length - 1);

      const data = await response.json();

      if (!response.ok) {
        const userMessages: Record<string, string> = {
          FACT_SHEET_NOT_APPROVED: "Please approve your fact sheet before generating.",
          PROFILE_REQUIRED: "Please complete your profile before generating.",
          OPENAI_API_KEY_REQUIRED: "OpenAI API key is not configured. Please contact support.",
          GENERATION_BLOCKED: data.message || "Generation is blocked due to pre-generation completeness issues.",
          GENERATION_FAILED: data.message || "SOP generation failed. Please try again.",
        };
        setError(userMessages[data.error] || data.message || data.error || "Generation failed");
        setGenerating(false);
        return;
      }

      if (data.workspaceUrl) {
        router.push(data.workspaceUrl);
      } else {
        sessionStorage.setItem("sop-result", JSON.stringify(data));
        router.push("/sop-result");
      }
    } catch (err: any) {
      clearInterval(stageInterval);
      setError("Network error during generation");
      setGenerating(false);
    }
  };

  return (
    <PageContainer>
      <WorkflowStepper />
      <PageHeader
        title="Review Fact Sheet"
        subtitle="Review all information before generating your document. Accuracy is critical."
      />

      {/* Status banner */}
      <div className={`rounded-card border p-5 mb-8 ${ready ? "bg-dvivid-success-light border-dvivid-success/30" : "bg-dvivid-warning-light border-dvivid-warning/30"}`}>
        <p className="text-sm font-medium">
          {ready
            ? "✓ All sections complete! Review and approve your fact sheet below."
            : `Profile is ${completion}% complete. Some sections are incomplete.`}
        </p>
      </div>

      {/* Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <FactSectionCard title="Personal" editLink="/personal" completed={!!(profile.personalDetails.firstName && profile.personalDetails.lastName)}>
          <FactRow label="Name" value={`${profile.personalDetails.firstName} ${profile.personalDetails.middleName} ${profile.personalDetails.lastName}`.trim()} />
          <FactRow label="Date of Birth" value={profile.personalDetails.dateOfBirth} />
          <FactRow label="Nationality" value={profile.personalDetails.nationality} />
          <FactRow label="City" value={profile.personalDetails.currentCity} />
          <FactRow label="Country" value={profile.personalDetails.currentCountry} />
          <FactRow label="Languages" value={profile.personalDetails.languages} />
        </FactSectionCard>

        <FactSectionCard title="Education" editLink="/education" completed={profile.education.length > 0}>
          {profile.education.length === 0 ? <p className="text-sm text-dvivid-text-muted">No education records added.</p> :
            profile.education.map((e) => (
              <div key={e.id} className="py-2 border-b last:border-0 border-dvivid-border-light">
                <p className="font-medium text-sm text-dvivid-text-primary">{e.degree || e.level} — {e.institution}</p>
                <div className="flex gap-4 text-xs text-dvivid-text-muted mt-1">
                  {e.cgpa && <span>CGPA: {e.cgpa}/{e.cgpaScale || "10"}</span>}
                  {e.percentage && <span>Percentage: {e.percentage}%</span>}
                  {e.startYear && <span>{e.startYear} - {e.endYear || "Ongoing"}</span>}
                </div>
              </div>
            ))}
        </FactSectionCard>

        <FactSectionCard title="English Proficiency" editLink="/english" completed={!!profile.englishProficiency.testType}>
          <FactRow label="Test" value={profile.englishProficiency.testType} />
          <FactRow label="Status" value={profile.englishProficiency.status} />
          <FactRow label="Overall Score" value={profile.englishProficiency.overallScore} />
          {profile.englishProficiency.testType === "IELTS" && (
            <>
              <FactRow label="Listening" value={profile.englishProficiency.listening} />
              <FactRow label="Reading" value={profile.englishProficiency.reading} />
              <FactRow label="Writing" value={profile.englishProficiency.writing} />
              <FactRow label="Speaking" value={profile.englishProficiency.speaking} />
            </>
          )}
        </FactSectionCard>

        <FactSectionCard title="Writing Preferences" editLink="/preferences" completed={!!profile.writingPreferences.sopWritingProfile.level}>
          <FactRow label="Writing Level" value={profile.writingPreferences.sopWritingProfile.level} />
          <FactRow label="Tone" value={profile.writingPreferences.sopWritingProfile.tone} />
          <FactRow label="SOP Length" value={profile.writingPreferences.sopWritingProfile.sopLength} />
          <FactRow label="Opening Style" value={profile.writingPreferences.sopWritingProfile.openingStyle} />
        </FactSectionCard>

        <FactSectionCard title="Experience" editLink="/experience" completed={profile.experience.length > 0}>
          {profile.experience.length === 0 ? <p className="text-sm text-dvivid-text-muted">No experience records.</p> :
            profile.experience.map(e => (
              <div key={e.id} className="py-2 border-b last:border-0 border-dvivid-border-light">
                <p className="font-medium text-sm text-dvivid-text-primary">{e.role} — {e.organization}</p>
                <p className="text-xs text-dvivid-text-muted">{e.type} | {e.startDate} - {e.currentlyWorking ? "Present" : e.endDate}</p>
              </div>
            ))}
        </FactSectionCard>

        <FactSectionCard title="Projects & Research" editLink="/projects" completed={profile.projects.length > 0 || profile.research.length > 0 || profile.publications.length > 0}>
          {profile.projects.length === 0 && profile.research.length === 0 && profile.publications.length === 0 ?
            <p className="text-sm text-dvivid-text-muted">No projects or research added.</p> :
            <>
              {profile.projects.map(p => <div key={p.id} className="py-1 text-sm"><span className="font-medium text-dvivid-text-primary">{p.name}</span> — {p.type}</div>)}
              {profile.research.map(r => <div key={r.id} className="py-1 text-sm"><span className="font-medium text-dvivid-text-primary">{r.topic}</span> — Research at {r.institution}</div>)}
              {profile.publications.map(p => <div key={p.id} className="py-1 text-sm"><span className="font-medium text-dvivid-text-primary">{p.title}</span> — {p.venue} ({p.year})</div>)}
            </>}
        </FactSectionCard>

        <FactSectionCard title="Achievements" editLink="/achievements" completed={profile.achievements.length > 0}>
          {profile.achievements.length === 0 ? <p className="text-sm text-dvivid-text-muted">No achievements added.</p> :
            profile.achievements.map(a => <div key={a.id} className="py-1 text-sm"><span className="font-medium text-dvivid-text-primary">{a.title}</span> — {a.type} ({a.year})</div>)}
        </FactSectionCard>

        <FactSectionCard title="Application" editLink="/application" completed={!!profile.application.targetUniversity}>
          <FactRow label="Target Country" value={profile.application.targetCountry} />
          <FactRow label="Target University" value={profile.application.targetUniversity} />
          <FactRow label="Target Program" value={profile.application.targetProgram} />
          <FactRow label="Degree Level" value={profile.application.degreeLevel} />
          <FactRow label="Intake" value={`${profile.application.intake} ${profile.application.intakeYear}`.trim()} />
          {profile.application.wordRequirement === "Known" && (
            <>
              <FactRow label="Min Words" value={profile.application.minWords} />
              <FactRow label="Max Words" value={profile.application.maxWords} />
            </>
          )}
          <FactRow label="SOP Question" value={profile.application.sopQuestion} />
        </FactSectionCard>

        <FactSectionCard title="Career Goals" editLink="/career" completed={!!profile.careerGoals.whyField}>
          <FactRow label="Why This Field" value={profile.careerGoals.whyField} />
          <FactRow label="Why This Program" value={profile.careerGoals.whyProgram} />
          <FactRow label="Short-term Goals" value={profile.careerGoals.shortTermGoals} />
          <FactRow label="Long-term Goals" value={profile.careerGoals.longTermGoals} />
          <FactRow label="Desired Role" value={profile.careerGoals.desiredRole} />
        </FactSectionCard>

        <FactSectionCard title="Personal Story" editLink="/personal-story" completed={!!profile.personalStory.motivation}>
          <FactRow label="Motivation" value={profile.personalStory.motivation} />
          <FactRow label="Challenges" value={profile.personalStory.challenges} />
          <FactRow label="Proud Of" value={profile.personalStory.proudOf} />
          <FactRow label="Qualities" value={profile.personalStory.qualities} />
        </FactSectionCard>

        <FactSectionCard title="Documents" editLink="/documents" completed={profile.documents.length > 0}>
          {profile.documents.length === 0 ? <p className="text-sm text-dvivid-text-muted">No documents uploaded.</p> :
            profile.documents.map(d => <div key={d.id} className="py-1 text-sm text-dvivid-text-primary">{d.type}: {d.fileName} ({d.fileSize})</div>)}
        </FactSectionCard>
      </div>

      {/* Approval + Generate */}
      <SectionCard title="Fact Sheet Approval" description="Confirm that the information above is accurate before generating.">
        <div className="space-y-5">
          <Checkbox label="I confirm that the information above is accurate." checked={approved} onChange={toggleApproval} />

          {approved && (
            <div className="bg-dvivid-success-light border border-dvivid-success/30 rounded-input p-4 text-sm text-dvivid-success font-medium">
              ✓ Fact Sheet Approved
            </div>
          )}

          {error && (
            <div className="bg-dvivid-error-light border border-dvivid-error/20 rounded-input p-4 text-sm text-dvivid-error">
              {error}
            </div>
          )}

          {generating && (
            <div className="bg-dvivid-primary-light border border-dvivid-primary-border rounded-input p-5">
              <p className="text-sm font-medium text-dvivid-primary mb-3">Generating your document...</p>
              <div className="space-y-2">
                {stageLabels.map((label, i) => (
                  <div key={i} className={`flex items-center gap-2.5 text-sm ${i <= stage ? "text-dvivid-text-primary" : "text-dvivid-text-muted"}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                      i < stage ? "bg-dvivid-primary text-white" :
                      i === stage ? "border-2 border-dvivid-primary text-dvivid-primary" :
                      "border-2 border-dvivid-border"
                    }`}>
                      {i < stage ? "✓" : i === stage ? "●" : ""}
                    </span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <PrimaryButton onClick={handleGenerate} disabled={!approved || generating} className="w-full">
            {generating ? "Generating..." : "Generate Document"}
          </PrimaryButton>
        </div>
      </SectionCard>
    </PageContainer>
  );
}
