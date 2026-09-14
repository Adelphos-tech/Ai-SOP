"use client";
import { useProfile } from "@/lib/persistence/ProfileContext";
import { FormShell } from "@/components/forms/FormShell";
import { SelectInput } from "@/components/forms/fields/SelectInput";
import { AddButton } from "@/components/forms/fields/AddButton";
import { DocumentRecord } from "@/types";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function DocumentsPage() {
  const { profile, updateProfile } = useProfile();

  const addDoc = () => updateProfile(p => ({ ...p, documents: [...p.documents, { id: `doc${Date.now()}`, type: "", fileName: "", fileSize: "", uploadDate: "" } as DocumentRecord] }));
  const removeDoc = (id: string) => updateProfile(p => ({ ...p, documents: p.documents.filter(d => d.id !== id) }));
  const updateDoc = (id: string, field: keyof DocumentRecord, value: string) => updateProfile(p => ({ ...p, documents: p.documents.map(d => d.id === id ? { ...d, [field]: value } : d) }));

  const handleFile = (id: string, file: File) => {
    if (file.size > MAX_SIZE) { alert("File too large. Maximum 10MB."); return; }
    updateDoc(id, "fileName", file.name);
    updateDoc(id, "fileSize", `${(file.size / 1024).toFixed(0)} KB`);
    updateDoc(id, "uploadDate", new Date().toISOString().split("T")[0]);
  };

  return (
    <FormShell title="Documents" description="Upload supporting documents. Files are stored locally for this MVP demo.">
      {profile.documents.map((doc, i) => (
        <div key={doc.id} className="border border-dvivid-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">Document #{i + 1}</h3>
            <button onClick={() => removeDoc(doc.id)} className="text-red-500 text-sm hover:text-red-700">Remove</button>
          </div>
          <SelectInput label="Document Type" required value={doc.type} onChange={v => updateDoc(doc.id, "type", v)} options={[{value:"CV/Resume",label:"CV / Resume"},{value:"Academic Transcript",label:"Academic Transcript"},{value:"Degree Certificate",label:"Degree Certificate"},{value:"English Test Result",label:"English Test Result"},{value:"Experience Letter",label:"Experience Letter"},{value:"Internship Certificate",label:"Internship Certificate"},{value:"Project Document",label:"Project Supporting Document"},{value:"Publication",label:"Publication"},{value:"Other",label:"Other"}]} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Upload File (max 10MB)</label>
            <input type="file" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(doc.id, f); }} className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-dvivid-blue file:text-white file:cursor-pointer" />
            {doc.fileName && <p className="text-xs text-green-600 mt-1">✓ {doc.fileName} ({doc.fileSize})</p>}
          </div>
        </div>
      ))}
      <AddButton label="Add Document" onClick={addDoc} />
    </FormShell>
  );
}
