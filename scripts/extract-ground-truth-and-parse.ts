import { parseCVFile } from '@/lib/application/cv-parser';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Document } from 'docx';

const STRESS_PACK = '/Users/shivang/Desktop/AI SOP/deploy/server-12b-cv-known-good/dvivid_complex_resume_stress_pack';

function extractPdfText(fpath: string): string {
  try {
    return execSync(`pdftotext -layout "${fpath}" -`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch { return ''; }
}

function extractDocxText(fpath: string): string {
  try {
    // Use simple docx extraction via the docx-validator approach
    const { extractDocxTextBounded } = require('@/lib/application/docx-validator');
    return extractDocxTextBounded(fs.readFileSync(fpath));
  } catch {
    return '';
  }
}

async function main() {
  const files = fs.readdirSync(STRESS_PACK)
    .filter(f => f.endsWith('.pdf') || f.endsWith('.docx'))
    .sort();

  const results: any[] = [];

  for (const file of files) {
    const fpath = path.join(STRESS_PACK, file);
    const ext = path.extname(file).toLowerCase();
    
    let rawText = '';
    if (ext === '.pdf') rawText = extractPdfText(fpath);
    else rawText = execSync(`cat "${fpath}" | strings`, { encoding: 'utf-8' }).slice(0, 5000); // rough for docx
    
    const start = Date.now();
    let parsed: any = null;
    let error: string = '';
    try {
      parsed = await parseCVFile(fs.readFileSync(fpath), file);
    } catch (e: any) {
      error = e.code || e.message;
    }
    const elapsed = Date.now() - start;

    results.push({
      file,
      elapsed_ms: elapsed,
      error,
      raw_text_first_2000: rawText.slice(0, 2000),
      parsed: parsed ? {
        personalData: parsed.personalData,
        education: parsed.education,
        experience: parsed.experience,
        projects: parsed.projects,
        skills: parsed.skills,
        certifications: parsed.certifications,
        achievements: parsed.achievements,
        warnings: parsed.parseWarnings,
      } : null
    });
    console.log(`Processed ${file}: ${error || 'OK'} (${elapsed}ms)`);
  }

  fs.writeFileSync('/tmp/cv-acceptance-data.json', JSON.stringify(results, null, 2));
  console.log('\nWrote /tmp/cv-acceptance-data.json');
}

main();
