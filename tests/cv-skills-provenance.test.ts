/**
 * cv-skills-provenance.test.ts — CV skill provenance on apply/replace.
 *
 * Proves: skills imported by a prior CV are removed on replaceCvDerived,
 * manual skills always survive, merge dedupes conservatively, and
 * reapplying the same CV produces no duplicates. Pure helpers — no DB.
 */
import assert from "node:assert/strict";
import { mergeCvSkills, removeCvDerivedSkills, normSkill } from "../src/lib/application/cv-merge";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}: ${(e as Error).message}`); }
}

const CAT = "tools";
const empty = () => ({ technical: [], programming: [], tools: [], domain: [], soft: [], software: [] });

check("B5-1: CV A apply → skills tagged with cv-importId", () => {
  const r = mergeCvSkills(empty(), {}, { ...empty(), tools: ["Jira", "Figma"] },
    { overwrite: false, importId: "cv-A" });
  assert.deepEqual(r.skills.tools.sort(), ["Figma", "Jira"]);
  assert.equal(r.skillProvenance.tools.jira, "cv-A");
  assert.equal(r.skillProvenance.tools.figma, "cv-A");
});

check("B5-2: manual add preserved; replace with CV B drops CV-A skills only", () => {
  const a = mergeCvSkills(empty(), {}, { ...empty(), tools: ["Jira", "Figma"] },
    { overwrite: false, importId: "cv-A" });
  // consultant manually adds a skill (no provenance entry)
  const withManual = { ...a.skills, tools: [...a.skills.tools, "Stakeholder Management"] };
  // replace CvDerived → remove CV-A skills
  const cleared = removeCvDerivedSkills(withManual, a.skillProvenance);
  assert.deepEqual(cleared.tools, ["Stakeholder Management"]);
  // apply CV B merge
  const b = mergeCvSkills(cleared, a.skillProvenance, { ...empty(), tools: ["SQL", "Power BI"] },
    { overwrite: false, importId: "cv-B" });
  assert.deepEqual(b.skills.tools.sort(), ["Power BI", "SQL", "Stakeholder Management"]);
  assert.equal(b.skillProvenance.tools.sql, "cv-B");
  assert.equal(b.skillProvenance.tools["stakeholder management"], undefined,
    "manual skill must not acquire CV provenance");
});

check("B5-3: MERGE mode dedupes + keeps all legitimate skills", () => {
  const existing = { ...empty(), tools: ["SQL", "Stakeholder Management"] };
  const r = mergeCvSkills(existing, {}, { ...empty(), tools: ["sql", "Power BI", "SQL"] },
    { overwrite: false, importId: "cv-B" });
  assert.deepEqual(r.skills.tools.sort(), ["Power BI", "SQL", "Stakeholder Management"],
    "case-insensitive dedupe, no duplicates");
});

check("B5-4: same CV reapplied → no duplicates", () => {
  const first = mergeCvSkills(empty(), {}, { ...empty(), tools: ["Jira", "Figma"] },
    { overwrite: false, importId: "cv-A" });
  const second = mergeCvSkills(first.skills, first.skillProvenance,
    { ...empty(), tools: ["Jira", "Figma"] }, { overwrite: false, importId: "cv-A2" });
  assert.deepEqual(second.skills.tools.sort(), ["Figma", "Jira"]);
});

check("B5-5: manual skill identical to CV skill → manual provenance preserved", () => {
  const existing = { ...empty(), tools: ["SQL"] };            // manual, no provenance
  const r = mergeCvSkills(existing, {}, { ...empty(), tools: ["sql", "Tableau"] },
    { overwrite: false, importId: "cv-B" });
  assert.deepEqual(r.skills.tools.sort(), ["SQL", "Tableau"]);
  assert.equal(r.skillProvenance.tools.sql, undefined, "manual 'sql' key must NOT be re-tagged cv-*");
  assert.equal(r.skillProvenance.tools.tableau, "cv-B");
});

check("B5-6: normalization keeps distinct skills distinct (C / C++ / .NET / ASP.NET)", () => {
  assert.notEqual(normSkill("C"), normSkill("C++"));
  assert.notEqual(normSkill(".NET"), normSkill("ASP.NET"));
  const r = mergeCvSkills(empty(), {},
    { ...empty(), programming: ["C", "C++", ".NET", "ASP.NET", "  C  "] },
    { overwrite: false, importId: "cv-A" });
  assert.deepEqual(r.skills.programming, ["C", "C++", ".NET", "ASP.NET"],
    "trailing-space 'C' dedupes against 'C'; all distinct skills retained");
});

check("B5-7: replaceCvDerived with no provenance (legacy) preserves all skills", () => {
  const skills = { ...empty(), tools: ["Jira", "Stakeholder Management"] };
  const out = removeCvDerivedSkills(skills, undefined);
  assert.deepEqual(out.tools!.sort(), ["Jira", "Stakeholder Management"],
    "no provenance → treated as manual → preserved");
});

check("B5-8: overwrite mode tags everything CV; stale provenance pruned", () => {
  const existing = { ...empty(), tools: ["OldManual"] };
  const prov = { tools: { "ghost skill": "cv-old" } };
  const r = mergeCvSkills(existing, prov, { ...empty(), tools: ["New"] },
    { overwrite: true, importId: "cv-B" });
  assert.deepEqual(r.skills.tools, ["New"]);
  assert.deepEqual(Object.keys(r.skillProvenance.tools), ["new"]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
