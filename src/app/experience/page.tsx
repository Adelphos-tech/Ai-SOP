"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { TextArea } from "@/components/forms/fields/TextArea";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { Checkbox } from "@/components/forms/fields/Checkbox";
import { AddButton } from "@/components/forms/fields/AddButton";
import { ExperienceRecord } from "@/types";

const emptyExp = (): ExperienceRecord => ({ id: `exp${Date.now()}`, type: "", organization: "", role: "", startDate: "", endDate: "", currentlyWorking: false, location: "", responsibilities: "", keyAchievements: "", skillsLearned: "" });

export default function ExperiencePage() {
  const { profile, updateProfile } = useProfile();
  const addExp = () => updateProfile(p => ({ ...p, experience: [...p.experience, emptyExp()] }));
  const removeExp = (id: string) => updateProfile(p => ({ ...p, experience: p.experience.filter(e => e.id !== id) }));
  const updateExp = (id: string, field: keyof ExperienceRecord, value: any) => updateProfile(p => ({ ...p, experience: p.experience.map(e => e.id === id ? { ...e, [field]: value } : e) }));

  return (
    <FormShell title="Experience" description="Add internships, full-time work, part-time work, or training.">
      {profile.experience.map((exp, i) => (
        <div key={exp.id} className="border border-dvivid-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">Experience #{i + 1}</h3>
            <button onClick={() => removeExp(exp.id)} className="text-red-500 text-sm hover:text-red-700">Remove</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectInput label="Type" required value={exp.type} onChange={v => updateExp(exp.id, "type", v)} options={[{value:"Internship",label:"Internship"},{value:"Full-Time Work",label:"Full-Time Work"},{value:"Part-Time Work",label:"Part-Time Work"},{value:"Training",label:"Training"}]} />
            <TextInput label="Organization" required value={exp.organization} onChange={v => updateExp(exp.id, "organization", v)} />
            <TextInput label="Role" value={exp.role} onChange={v => updateExp(exp.id, "role", v)} />
            <TextInput label="Location" value={exp.location} onChange={v => updateExp(exp.id, "location", v)} />
            <TextInput label="Start Date" type="month" value={exp.startDate} onChange={v => updateExp(exp.id, "startDate", v)} />
            <TextInput label="End Date" type="month" value={exp.endDate} onChange={v => updateExp(exp.id, "endDate", v)} disabled={exp.currentlyWorking} />
          </div>
          <Checkbox label="I currently work here" checked={exp.currentlyWorking} onChange={v => updateExp(exp.id, "currentlyWorking", v)} />
          <TextArea label="Responsibilities" value={exp.responsibilities} onChange={v => updateExp(exp.id, "responsibilities", v)} rows={3} />
          <TextArea label="Key Achievements" value={exp.keyAchievements} onChange={v => updateExp(exp.id, "keyAchievements", v)} rows={2} />
          <TextInput label="Skills Learned" value={exp.skillsLearned} onChange={v => updateExp(exp.id, "skillsLearned", v)} placeholder="e.g., Python, Project Management, Communication" />
        </div>
      ))}
      <AddButton label="Add Experience" onClick={addExp} />
    </FormShell>
  );
}
