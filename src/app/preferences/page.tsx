"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { TextInput } from "@/components/forms/fields/TextInput";

export default function PreferencesPage() {
  const { profile, updateProfile } = useProfile();
  const wp = profile.writingPreferences.sopWritingProfile;
  const update = (field: string, value: string) => updateProfile(p => ({ ...p, writingPreferences: { ...p.writingPreferences, sopWritingProfile: { ...p.writingPreferences.sopWritingProfile, [field]: value } } }));

  return (
    <FormShell title="SOP Preferences" description="Configure how you want your SOP to be written. These settings will guide the AI writing process.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SelectInput label="SOP Length" value={wp.sopLength} onChange={v => update("sopLength", v)} options={[{value:"Use University Requirement",label:"Use University Requirement"},{value:"500-700",label:"500-700 words"},{value:"700-900",label:"700-900 words"},{value:"900-1100",label:"900-1100 words"},{value:"Custom",label:"Custom"}]} />
        <SelectInput label="Writing Level" value={wp.level} onChange={v => update("level", v)} options={[{value:"Simple & Clear",label:"Simple & Clear"},{value:"Natural Professional",label:"Natural Professional"},{value:"Advanced Academic",label:"Advanced Academic"},{value:"Consultant Polished",label:"Consultant Polished"}]} />
        <SelectInput label="Tone" value={wp.tone} onChange={v => update("tone", v)} options={[{value:"Professional & Personal",label:"Professional & Personal"},{value:"Academic",label:"Academic"},{value:"Story-Driven",label:"Story-Driven"},{value:"Formal",label:"Formal"}]} />
        <SelectInput label="Personalization" value={wp.personalization} onChange={v => update("personalization", v)} options={[{value:"Balanced",label:"Balanced"},{value:"Highly Personalized",label:"Highly Personalized"},{value:"Mostly Academic",label:"Mostly Academic"}]} />
        <SelectInput label="Technical Detail" value={wp.technicalDetail} onChange={v => update("technicalDetail", v)} options={[{value:"Low",label:"Low"},{value:"Medium",label:"Medium"},{value:"High",label:"High"}]} />
        <SelectInput label="Opening Style" value={wp.openingStyle} onChange={v => update("openingStyle", v)} options={[{value:"Natural Academic Journey",label:"Natural Academic Journey"},{value:"Project/Experience Led",label:"Project/Experience Led"},{value:"Personal Story Led",label:"Personal Story Led"},{value:"Professional Experience Led",label:"Professional Experience Led"},{value:"Let AI Choose Best Opening",label:"Let AI Choose Best Opening"}]} />
      </div>
      {wp.sopLength === "Custom" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
          <TextInput label="Custom Minimum Words" value={wp.customMinWords} onChange={v => update("customMinWords", v)} placeholder="e.g., 800" />
          <TextInput label="Custom Maximum Words" value={wp.customMaxWords} onChange={v => update("customMaxWords", v)} placeholder="e.g., 1200" />
        </div>
      )}
    </FormShell>
  );
}
