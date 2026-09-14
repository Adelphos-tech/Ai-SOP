"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { TextArea } from "@/components/forms/fields/TextArea";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { AddButton } from "@/components/forms/fields/AddButton";
import { AchievementRecord } from "@/types";

const emptyAch = (): AchievementRecord => ({ id: `ach${Date.now()}`, type: "", title: "", description: "", year: "" });

export default function AchievementsPage() {
  const { profile, updateProfile } = useProfile();
  const addAch = () => updateProfile(p => ({ ...p, achievements: [...p.achievements, emptyAch()] }));
  const removeAch = (id: string) => updateProfile(p => ({ ...p, achievements: p.achievements.filter(x => x.id !== id) }));
  const updateAch = (id: string, field: keyof AchievementRecord, value: string) => updateProfile(p => ({ ...p, achievements: p.achievements.map(x => x.id === id ? { ...x, [field]: value } : x) }));

  return (
    <FormShell title="Certifications & Achievements" description="Add certifications, awards, academic achievements, competitions, scholarships, volunteer work, leadership, and extracurricular activities.">
      {profile.achievements.map((ach, i) => (
        <div key={ach.id} className="border border-dvivid-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">Item #{i + 1}</h3>
            <button onClick={() => removeAch(ach.id)} className="text-red-500 text-sm hover:text-red-700">Remove</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectInput label="Type" required value={ach.type} onChange={v => updateAch(ach.id, "type", v)} options={[{value:"Certification",label:"Certification"},{value:"Award",label:"Award"},{value:"Academic Achievement",label:"Academic Achievement"},{value:"Competition",label:"Competition"},{value:"Scholarship",label:"Scholarship"},{value:"Volunteer Work",label:"Volunteer Work"},{value:"Leadership",label:"Leadership"},{value:"Extracurricular",label:"Extracurricular"}]} />
            <TextInput label="Title" required value={ach.title} onChange={v => updateAch(ach.id, "title", v)} />
            <TextInput label="Year" value={ach.year} onChange={v => updateAch(ach.id, "year", v)} placeholder="e.g., 2023" />
          </div>
          <TextArea label="Description" value={ach.description} onChange={v => updateAch(ach.id, "description", v)} rows={2} />
        </div>
      ))}
      <AddButton label="Add Achievement" onClick={addAch} />
    </FormShell>
  );
}
