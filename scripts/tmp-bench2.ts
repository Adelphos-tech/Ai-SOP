import { readFileSync } from "fs";
import mammoth from "mammoth";
import { mapDoclingToParsedCV } from "../src/lib/application/cv-mapper-docling";

async function main() {
  // does mammoth at least get text from kunj docx?
  const k = await mammoth.extractRawText({ buffer: readFileSync("/Users/shivang/Desktop/AI SOP/Test pdf/kunj modh (1) (1).docx") });
  console.log("KUNJ-DOCX mammoth raw:", k.value.length, "chars | head:", JSON.stringify(k.value.slice(0,120)));
  for (const label of ["SHIVANG-DOCX","SHIVANG-PDF","KUNJ-PDF"]) {
    try {
      const doc = JSON.parse(readFileSync(`/tmp/docling-${label}.json`,"utf-8"));
      const p = mapDoclingToParsedCV(doc);
      const skills = Object.values(p.skills||{}).reduce((n:number,b:any)=>n+((b as any)?.length||0),0);
      console.log(`${label} docling-map: name=${[p.personalData?.firstName,p.personalData?.lastName].filter(Boolean).join(" ")} edu=${p.education?.length} exp=${p.experience?.length} skills=${skills} certs=${p.certifications?.length} ach=${p.achievements?.length}`);
    } catch(e:any){ console.log(label,"MAPPER-FAIL",e.code||e.message); }
  }
}
main();
