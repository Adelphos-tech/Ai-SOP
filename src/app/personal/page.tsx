"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { SelectInput } from "@/components/forms/fields/SelectInput";

export default function PersonalPage() {
  const { profile, updateProfile } = useProfile();
  const pd = profile.personalDetails;
  return (
    <FormShell title="Personal Details" description="Tell us about yourself. This information will be used in your SOP.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TextInput label="First Name" required value={pd.firstName} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, firstName: v } }))} />
        <TextInput label="Middle Name" optional value={pd.middleName} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, middleName: v } }))} />
        <TextInput label="Last Name" required value={pd.lastName} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, lastName: v } }))} />
        <TextInput label="Date of Birth" type="date" required value={pd.dateOfBirth} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, dateOfBirth: v } }))} />
        <SelectInput label="Gender" optional value={pd.gender} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, gender: v as any } }))} options={[{value:"Male",label:"Male"},{value:"Female",label:"Female"},{value:"Non-binary",label:"Non-binary"},{value:"Other",label:"Other"},{value:"Prefer not to say",label:"Prefer not to say"}]} />
        <TextInput label="Nationality" required value={pd.nationality} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, nationality: v } }))} placeholder="e.g., Indian" />
        <TextInput label="Current City" required value={pd.currentCity} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, currentCity: v } }))} placeholder="e.g., Surat" />
        <TextInput label="Current Country" required value={pd.currentCountry} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, currentCountry: v } }))} placeholder="e.g., India" />
        <TextInput label="Languages Known" optional value={pd.languages} onChange={v => updateProfile(p => ({ ...p, personalDetails: { ...p.personalDetails, languages: v } }))} placeholder="e.g., English, Hindi, Gujarati" />
      </div>
    </FormShell>
  );
}
