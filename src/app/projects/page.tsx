"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { TextInput } from "@/components/forms/fields/TextInput";
import { TextArea } from "@/components/forms/fields/TextArea";
import { AddButton } from "@/components/forms/fields/AddButton";
import { ProjectRecord, ResearchRecord, PublicationRecord } from "@/types";

export default function ProjectsPage() {
  const { profile, updateProfile } = useProfile();

  // Projects
  const addProj = () => updateProfile(p => ({ ...p, projects: [...p.projects, { id: `proj${Date.now()}`, name: "", type: "", description: "", studentRole: "", technologies: "", outcome: "", whatLearned: "" } as ProjectRecord] }));
  const removeProj = (id: string) => updateProfile(p => ({ ...p, projects: p.projects.filter(x => x.id !== id) }));
  const updateProj = (id: string, field: keyof ProjectRecord, value: string) => updateProfile(p => ({ ...p, projects: p.projects.map(x => x.id === id ? { ...x, [field]: value } : x) }));

  // Research
  const addRes = () => updateProfile(p => ({ ...p, research: [...p.research, { id: `res${Date.now()}`, topic: "", institution: "", role: "", description: "", outcome: "" } as ResearchRecord] }));
  const removeRes = (id: string) => updateProfile(p => ({ ...p, research: p.research.filter(x => x.id !== id) }));
  const updateRes = (id: string, field: keyof ResearchRecord, value: string) => updateProfile(p => ({ ...p, research: p.research.map(x => x.id === id ? { ...x, [field]: value } : x) }));

  // Publications
  const addPub = () => updateProfile(p => ({ ...p, publications: [...p.publications, { id: `pub${Date.now()}`, title: "", venue: "", status: "", year: "", link: "" } as PublicationRecord] }));
  const removePub = (id: string) => updateProfile(p => ({ ...p, publications: p.publications.filter(x => x.id !== id) }));
  const updatePub = (id: string, field: keyof PublicationRecord, value: string) => updateProfile(p => ({ ...p, publications: p.publications.map(x => x.id === id ? { ...x, [field]: value } : x) }));

  return (
    <FormShell title="Projects & Research" description="Add academic projects, research work, and publications.">
      {/* Projects */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-700 border-b pb-2">Projects</h3>
        {profile.projects.map((proj, i) => (
          <div key={proj.id} className="border border-dvivid-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-600">Project #{i + 1}</h4>
              <button onClick={() => removeProj(proj.id)} className="text-red-500 text-sm">Remove</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput label="Project Name" value={proj.name} onChange={v => updateProj(proj.id, "name", v)} />
              <TextInput label="Project Type" value={proj.type} onChange={v => updateProj(proj.id, "type", v)} placeholder="e.g., Academic, Personal, Hackathon" />
            </div>
            <TextArea label="Description" value={proj.description} onChange={v => updateProj(proj.id, "description", v)} rows={3} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput label="Student's Role" value={proj.studentRole} onChange={v => updateProj(proj.id, "studentRole", v)} />
              <TextInput label="Technologies / Skills" value={proj.technologies} onChange={v => updateProj(proj.id, "technologies", v)} />
            </div>
            <TextInput label="Outcome" value={proj.outcome} onChange={v => updateProj(proj.id, "outcome", v)} />
            <TextInput label="What You Learned" value={proj.whatLearned} onChange={v => updateProj(proj.id, "whatLearned", v)} />
          </div>
        ))}
        <AddButton label="Add Project" onClick={addProj} />
      </div>

      {/* Research */}
      <div className="space-y-4 border-t pt-4">
        <h3 className="font-semibold text-gray-700 border-b pb-2">Research</h3>
        {profile.research.map((res, i) => (
          <div key={res.id} className="border border-dvivid-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-600">Research #{i + 1}</h4>
              <button onClick={() => removeRes(res.id)} className="text-red-500 text-sm">Remove</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput label="Topic" value={res.topic} onChange={v => updateRes(res.id, "topic", v)} />
              <TextInput label="Institution" value={res.institution} onChange={v => updateRes(res.id, "institution", v)} />
            </div>
            <TextInput label="Role" value={res.role} onChange={v => updateRes(res.id, "role", v)} />
            <TextArea label="Description" value={res.description} onChange={v => updateRes(res.id, "description", v)} rows={2} />
            <TextInput label="Outcome" value={res.outcome} onChange={v => updateRes(res.id, "outcome", v)} />
          </div>
        ))}
        <AddButton label="Add Research" onClick={addRes} />
      </div>

      {/* Publications */}
      <div className="space-y-4 border-t pt-4">
        <h3 className="font-semibold text-gray-700 border-b pb-2">Publications</h3>
        {profile.publications.map((pub, i) => (
          <div key={pub.id} className="border border-dvivid-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-600">Publication #{i + 1}</h4>
              <button onClick={() => removePub(pub.id)} className="text-red-500 text-sm">Remove</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput label="Title" value={pub.title} onChange={v => updatePub(pub.id, "title", v)} />
              <TextInput label="Publication / Conference" value={pub.venue} onChange={v => updatePub(pub.id, "venue", v)} />
              <TextInput label="Status" value={pub.status} onChange={v => updatePub(pub.id, "status", v)} placeholder="e.g., Published, Under Review" />
              <TextInput label="Year" value={pub.year} onChange={v => updatePub(pub.id, "year", v)} />
            </div>
            <TextInput label="Link (optional)" value={pub.link} onChange={v => updatePub(pub.id, "link", v)} />
          </div>
        ))}
        <AddButton label="Add Publication" onClick={addPub} />
      </div>
    </FormShell>
  );
}
