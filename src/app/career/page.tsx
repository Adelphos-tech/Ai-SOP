"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextArea } from "@/components/forms/fields/TextArea";
import { SelectInput } from "@/components/forms/fields/SelectInput";

export default function CareerPage() {
  const { profile, updateProfile } = useProfile();
  const cg = profile.careerGoals;
  const update = (field: string, value: string) => updateProfile(p => ({ ...p, careerGoals: { ...p.careerGoals, [field]: value } }));

  return (
    <FormShell title="Career Goals" description="Help us understand your career aspirations.">
      <div className="space-y-4">
        <TextArea label="Why have you chosen this field?" value={cg.whyField} onChange={v => update("whyField", v)} rows={3} />
        <TextArea label="Why do you want to study this program?" value={cg.whyProgram} onChange={v => update("whyProgram", v)} rows={3} />
        <TextArea label="What are your short-term career goals?" value={cg.shortTermGoals} onChange={v => update("shortTermGoals", v)} rows={2} />
        <TextArea label="What are your long-term career goals?" value={cg.longTermGoals} onChange={v => update("longTermGoals", v)} rows={2} />
        <TextArea label="What type of role do you want after graduation?" value={cg.desiredRole} onChange={v => update("desiredRole", v)} rows={2} />
        <TextArea label="What industries interest you?" value={cg.industries} onChange={v => update("industries", v)} rows={2} placeholder="e.g., Technology, Healthcare, Finance" />
        <SelectInput label="Do you intend to return to your home country?" value={cg.returnHomeCountry} onChange={v => update("returnHomeCountry", v)} options={[{value:"Yes",label:"Yes"},{value:"No",label:"No"},{value:"Not applicable",label:"Not applicable / Prefer not to say"}]} />
        {cg.returnHomeCountry === "Yes" && (
          <TextArea label="What do you plan to do after returning?" value={cg.returnPlans} onChange={v => update("returnPlans", v)} rows={2} />
        )}
      </div>
    </FormShell>
  );
}
