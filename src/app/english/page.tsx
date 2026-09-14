"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { recommendWritingLevel, writingLevelDescriptions, writingLevelPreviews } from "@/lib/writing-profile/recommendation";
import { WritingLevel } from "@/types";

export default function EnglishPage() {
  const { profile, updateProfile } = useProfile();
  const ep = profile.englishProficiency;
  const wp = profile.writingPreferences.sopWritingProfile;
  const recommended = recommendWritingLevel(ep.testType, ep.overallScore);

  const updateEP = (field: string, value: string) => {
    updateProfile(p => ({ ...p, englishProficiency: { ...p.englishProficiency, [field]: value }, writingPreferences: { ...p.writingPreferences, actualEnglishProficiency: { ...p.englishProficiency, [field]: value } } }));
  };
  const updateWP = (field: string, value: string) => {
    updateProfile(p => ({ ...p, writingPreferences: { ...p.writingPreferences, sopWritingProfile: { ...p.writingPreferences.sopWritingProfile, [field]: value } } }));
  };

  const showScores = ["IELTS","PTE","TOEFL","Duolingo"].includes(ep.testType);
  const showIELTS = ep.testType === "IELTS";

  return (
    <FormShell title="English Proficiency" description="Enter your English test scores. This helps calibrate the SOP writing level.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectInput label="English Test Taken" required value={ep.testType} onChange={v => updateEP("testType", v)} options={[{value:"IELTS",label:"IELTS"},{value:"PTE",label:"PTE Academic"},{value:"TOEFL",label:"TOEFL"},{value:"Duolingo",label:"Duolingo English Test"},{value:"None",label:"None"},{value:"Other",label:"Other"}]} />
        <SelectInput label="Test Status" value={ep.status} onChange={v => updateEP("status", v)} options={[{value:"Completed",label:"Completed"},{value:"Scheduled",label:"Scheduled"},{value:"Not Taken",label:"Not Taken"}]} />
      </div>
      {showScores && (
        <div className="border-t pt-4 space-y-4">
          <h3 className="font-semibold text-gray-700">Test Scores</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextInput label={showIELTS ? "Overall Band Score (0-9)" : "Overall Score"} required value={ep.overallScore} onChange={v => updateEP("overallScore", v)} placeholder={showIELTS ? "e.g., 7.0" : "e.g., 85"} />
            {showIELTS && (<>
              <TextInput label="Listening" value={ep.listening} onChange={v => updateEP("listening", v)} placeholder="e.g., 7.5" />
              <TextInput label="Reading" value={ep.reading} onChange={v => updateEP("reading", v)} placeholder="e.g., 7.0" />
              <TextInput label="Writing" value={ep.writing} onChange={v => updateEP("writing", v)} placeholder="e.g., 6.5" />
              <TextInput label="Speaking" value={ep.speaking} onChange={v => updateEP("speaking", v)} placeholder="e.g., 7.0" />
            </>)}
          </div>
        </div>
      )}
      <div className="border-t pt-4 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-700">SOP Writing Level</h3>
          <p className="text-xs text-gray-500 mt-1">Internal SOP writing-style recommendation, not an official IELTS band conversion. Lower scores do NOT mean bad grammar — we never introduce errors. This adjusts vocabulary sophistication and sentence complexity only.</p>
        </div>
        {recommended && !wp.level && (
          <div className="bg-dvivid-blue-lighter border border-dvivid-blue/20 rounded-lg p-3 text-sm">
            <span className="font-medium text-dvivid-blue">Recommended Level:</span> {recommended}
            <button onClick={() => updateWP("level", recommended)} className="ml-3 text-dvivid-blue underline text-xs">Apply Recommendation</button>
          </div>
        )}
        <SelectInput label="Writing Level" value={wp.level} onChange={v => updateWP("level", v)} options={[{value:"Simple & Clear",label:"Simple & Clear"},{value:"Natural Professional",label:"Natural Professional"},{value:"Advanced Academic",label:"Advanced Academic"},{value:"Consultant Polished",label:"Consultant Polished"},{value:"Custom",label:"Custom"}]} />
        {wp.level && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div><h4 className="text-sm font-semibold text-gray-700 mb-1">What this means:</h4><p className="text-sm text-gray-600">{writingLevelDescriptions[wp.level as WritingLevel]}</p></div>
            <div><h4 className="text-sm font-semibold text-gray-700 mb-1">Preview:</h4><p className="text-sm text-gray-600 italic">{writingLevelPreviews[wp.level]}</p></div>
          </div>
        )}
      </div>
    </FormShell>
  );
}
