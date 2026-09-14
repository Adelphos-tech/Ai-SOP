"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { TextArea } from "@/components/forms/fields/TextArea";
import { SelectInput } from "@/components/forms/fields/SelectInput";

export default function ApplicationPage() {
  const { profile, updateProfile } = useProfile();
  const app = profile.application;
  const update = (field: string, value: string) => updateProfile(p => ({ ...p, application: { ...p.application, [field]: value } }));

  return (
    <FormShell title="Course & University" description="Tell us about the program you are applying to.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextInput label="Target Country" required value={app.targetCountry} onChange={v => update("targetCountry", v)} placeholder="e.g., USA" />
        <TextInput label="Target University" value={app.targetUniversity} onChange={v => update("targetUniversity", v)} placeholder="e.g., Arizona State University" />
        <TextInput label="Target Program / Course" required value={app.targetProgram} onChange={v => update("targetProgram", v)} placeholder="e.g., MS in Computer Science" />
        <SelectInput label="Degree Level" value={app.degreeLevel} onChange={v => update("degreeLevel", v)} options={[{value:"Bachelor's",label:"Bachelor's"},{value:"Master's",label:"Master's"},{value:"PhD",label:"PhD"},{value:"Diploma",label:"Diploma"},{value:"Certificate",label:"Certificate"}]} />
        <SelectInput label="Intake" value={app.intake} onChange={v => update("intake", v)} options={[{value:"Fall",label:"Fall"},{value:"Spring",label:"Spring"},{value:"Summer",label:"Summer"},{value:"Winter",label:"Winter"}]} />
        <TextInput label="Intake Year" value={app.intakeYear} onChange={v => update("intakeYear", v)} placeholder="e.g., 2024" />
      </div>
      <div className="border-t pt-4 space-y-4">
        <h3 className="font-semibold text-gray-700">SOP Word Requirement</h3>
        <SelectInput label="Do you know the word limit?" value={app.wordRequirement} onChange={v => update("wordRequirement", v)} options={[{value:"Known",label:"Yes, I know the word limit"},{value:"Unknown",label:"No, I don't know"}]} />
        {app.wordRequirement === "Known" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TextInput label="Minimum Words" value={app.minWords} onChange={v => update("minWords", v)} placeholder="e.g., 800" />
            <TextInput label="Maximum Words" value={app.maxWords} onChange={v => update("maxWords", v)} placeholder="e.g., 1000" />
            <TextInput label="Maximum Characters" value={app.maxCharacters} onChange={v => update("maxCharacters", v)} placeholder="e.g., 5000" />
          </div>
        )}
      </div>
      <div className="border-t pt-4">
        <TextArea label="University SOP Question / Prompt" value={app.sopQuestion} onChange={v => update("sopQuestion", v)} rows={3} placeholder="Paste the university's SOP question here, e.g., 'Why do you wish to pursue this program?'" />
      </div>
      <div className="border-t pt-4 space-y-4">
        <h3 className="font-semibold text-gray-700">Official Source URLs (Optional)</h3>
        <p className="text-xs text-gray-500">If your university is not in our registry, provide the official requirements page URL and/or AI policy page URL. The backend will fetch and verify from these pages.</p>
        <TextInput label="Official Requirements Page URL" value={app.officialRequirementsUrl} onChange={v => update("officialRequirementsUrl", v)} placeholder="e.g., https://grad.mit.edu/programs/civil-environmental/admissions/" />
        <TextInput label="Official AI Policy Page URL" value={app.officialAiPolicyUrl} onChange={v => update("officialAiPolicyUrl", v)} placeholder="e.g., https://grad.mit.edu/policies/ai-use/" />
      </div>
      <div className="border-t pt-4">
        <h3 className="font-semibold text-gray-700 mb-2">AI Usage Policy</h3>
        <p className="text-xs text-gray-500 mb-3">Many universities restrict AI-assisted application writing. We need your confirmation before generating.</p>
        <SelectInput label="Does this university permit AI assistance for your SOP?" value={app.aiPolicyAttestation} onChange={v => update("aiPolicyAttestation", v)} options={[{value:"",label:"Not selected — generation will be blocked"},{value:"ALLOWED",label:"Yes, AI assistance is permitted"},{value:"PROHIBITED",label:"No, AI writing is prohibited"},{value:"UNKNOWN",label:"I don't know — generation will be blocked"}]} />
      </div>
    </FormShell>
  );
}
