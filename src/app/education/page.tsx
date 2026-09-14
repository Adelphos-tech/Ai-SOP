"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { AddButton } from "@/components/forms/fields/AddButton";
import { EducationRecord } from "@/types";

const emptyEdu = (): EducationRecord => ({ id: `edu${Date.now()}`, level: "", institution: "", board: "", degree: "", specialization: "", startYear: "", endYear: "", percentage: "", cgpa: "", cgpaScale: "", backlogs: "", status: "" });

export default function EducationPage() {
  const { profile, updateProfile } = useProfile();
  const addEdu = () => updateProfile(p => ({ ...p, education: [...p.education, emptyEdu()] }));
  const removeEdu = (id: string) => updateProfile(p => ({ ...p, education: p.education.filter(e => e.id !== id) }));
  const updateEdu = (id: string, field: keyof EducationRecord, value: string) => updateProfile(p => ({ ...p, education: p.education.map(e => e.id === id ? { ...e, [field]: value } : e) }));

  return (
    <FormShell title="Education History" description="Add all your educational qualifications from 10th onwards.">
      {profile.education.map((edu, i) => (
        <div key={edu.id} className="border border-dvivid-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">Education #{i + 1}</h3>
            <button onClick={() => removeEdu(edu.id)} className="text-red-500 text-sm hover:text-red-700">Remove</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectInput label="Education Level" required value={edu.level} onChange={v => updateEdu(edu.id, "level", v)} options={[{value:"10th",label:"10th Standard"},{value:"12th",label:"12th Standard"},{value:"Diploma",label:"Diploma"},{value:"Bachelor's",label:"Bachelor's"},{value:"Master's",label:"Master's"},{value:"PhD",label:"PhD"},{value:"Other",label:"Other"}]} />
            <TextInput label="Institution / School / University" required value={edu.institution} onChange={v => updateEdu(edu.id, "institution", v)} />
            <TextInput label="Board / University" value={edu.board} onChange={v => updateEdu(edu.id, "board", v)} />
            <TextInput label="Course / Degree" value={edu.degree} onChange={v => updateEdu(edu.id, "degree", v)} />
            <TextInput label="Specialization" value={edu.specialization} onChange={v => updateEdu(edu.id, "specialization", v)} />
            <TextInput label="Start Year" value={edu.startYear} onChange={v => updateEdu(edu.id, "startYear", v)} placeholder="e.g., 2019" />
            <TextInput label="End Year" value={edu.endYear} onChange={v => updateEdu(edu.id, "endYear", v)} placeholder="e.g., 2023" />
            <TextInput label="Percentage" value={edu.percentage} onChange={v => updateEdu(edu.id, "percentage", v)} placeholder="e.g., 85" />
            <TextInput label="CGPA" value={edu.cgpa} onChange={v => updateEdu(edu.id, "cgpa", v)} placeholder="e.g., 8.5" />
            <TextInput label="CGPA Scale" value={edu.cgpaScale} onChange={v => updateEdu(edu.id, "cgpaScale", v)} placeholder="e.g., 10" />
            <TextInput label="Backlogs" optional value={edu.backlogs} onChange={v => updateEdu(edu.id, "backlogs", v)} placeholder="e.g., 0" />
            <SelectInput label="Status" value={edu.status} onChange={v => updateEdu(edu.id, "status", v)} options={[{value:"Completed",label:"Completed"},{value:"Ongoing",label:"Ongoing"}]} />
          </div>
        </div>
      ))}
      <AddButton label="Add Education" onClick={addEdu} />
    </FormShell>
  );
}
