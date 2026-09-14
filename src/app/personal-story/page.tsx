"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextArea } from "@/components/forms/fields/TextArea";

export default function PersonalStoryPage() {
  const { profile, updateProfile } = useProfile();
  const ps = profile.personalStory;
  const update = (field: string, value: string) => updateProfile(p => ({ ...p, personalStory: { ...p.personalStory, [field]: value } }));

  return (
    <FormShell title="Personal Story" description="Share personal experiences that shaped your academic journey. Every question allows 'Not applicable / Prefer not to include'.">
      <div className="space-y-4">
        <div>
          <TextArea label="What motivated your academic journey?" value={ps.motivation} onChange={v => update("motivation", v)} rows={3} />
          <p className="text-xs text-gray-400 mt-1">Or write "Not applicable / Prefer not to include"</p>
        </div>
        <TextArea label="Was there a specific experience that influenced your career choice?" value={ps.influencingExperience} onChange={v => update("influencingExperience", v)} rows={3} />
        <TextArea label="What challenges have you overcome?" value={ps.challenges} onChange={v => update("challenges", v)} rows={3} />
        <TextArea label="What are you most proud of?" value={ps.proudOf} onChange={v => update("proudOf", v)} rows={2} />
        <TextArea label="What qualities describe you?" value={ps.qualities} onChange={v => update("qualities", v)} rows={2} />
        <TextArea label="Give an example of leadership." value={ps.leadershipExample} onChange={v => update("leadershipExample", v)} rows={2} />
        <TextArea label="Give an example of teamwork." value={ps.teamworkExample} onChange={v => update("teamworkExample", v)} rows={2} />
        <TextArea label="What do you do outside academics/work?" value={ps.outsideAcademics} onChange={v => update("outsideAcademics", v)} rows={2} />
        <TextArea label="Community service / volunteering?" value={ps.communityService} onChange={v => update("communityService", v)} rows={2} />
        <TextArea label="Family or personal background relevant to your academic journey?" value={ps.familyBackground} onChange={v => update("familyBackground", v)} rows={3} />
      </div>
    </FormShell>
  );
}
