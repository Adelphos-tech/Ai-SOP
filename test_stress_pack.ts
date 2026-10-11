import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseCVFile } from './src/lib/application/cv-parser.js';

// Stress pack directory
const stressPackDir = '/Users/shivang/Desktop/AI SOP/deploy/server-12b/dvivid_complex_resume_stress_pack';

// Output directory for results
const outputDir = '/Users/shivang/Desktop/AI SOP/deploy/server-12b/tests/cv-stress';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get all files in the stress pack directory
const files = fs.readdirSync(stressPackDir);

// Filter to only resume files (PDF, DOCX)
const resumeFiles = files.filter(file => 
  file.endsWith('.pdf') || file.endsWith('.docx')
);

// Sort for consistent processing
resumeFiles.sort();

console.log(`Found ${resumeFiles.length} resume files to process`);

// Results array
const results = [];

// Process each file
async function processFile(file: string) {
  const filePath = path.join(stressPackDir, file);
  console.log(`Processing ${file}...`);
  
  try {
    // Read file buffer
    const buffer = fs.readFileSync(filePath);
    
    // Calculate SHA256 hash
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    
    // Get file size
    const stats = fs.statSync(filePath);
    const size = stats.size;
    
    // Parse the CV
    const parsedCV = await parseCVFile(buffer, file);
    
    // Extract required information
    const result = {
      file: file,
      hash: hash,
      size: size,
      extractionStrategy: parsedCV.parserMeta?.engine || 'legacy',
      detectedSections: getDetectedSections(parsedCV),
      unknownSections: [],
      education: parsedCV.education.length,
      experience: parsedCV.experience.length,
      projects: parsedCV.projects.length,
      skills: {
        technical: parsedCV.skills.technical.length,
        programming: parsedCV.skills.programming.length,
        tools: parsedCV.skills.tools.length,
        software: parsedCV.skills.software.length,
        domain: parsedCV.skills.domain.length,
        soft: parsedCV.skills.soft.length
      },
      certifications: parsedCV.certifications.length,
      achievements: parsedCV.achievements.length,
      warnings: parsedCV.parseWarnings,
      suspiciousRecords: detectSuspiciousRecords(parsedCV),
      parseOutcome: 'SUCCESS' as const
    };
    
    results.push(result);
    console.log(`  ✓ Processed ${file}: ${parsedCV.education.length} education, ${parsedCV.experience.length} experience, ${parsedCV.projects.length} projects`);
    
  } catch (error: any) {
    console.log(`  ✗ Failed to process ${file}: ${error.message}`);
    
    // Still create a result entry for failed files
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const stats = fs.statSync(filePath);
    const size = stats.size;
    
    const result = {
      file: file,
      hash: hash,
      size: size,
      extractionStrategy: 'FAILED',
      detectedSections: [],
      unknownSections: [],
      education: 0,
      experience: 0,
      projects: 0,
      skills: { technical: 0, programming: 0, tools: 0, software: 0, domain: 0, soft: 0 },
      certifications: 0,
      achievements: 0,
      warnings: [error.message || 'Unknown error'],
      suspiciousRecords: [],
      parseOutcome: error.code || 'PARSE_FAILED'
    };
    
    results.push(result);
  }
}

async function main() {
  for (const file of resumeFiles) {
    await processFile(file);
  }

  // Write results to JSON file
  const outputPath = path.join(outputDir, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Results written to ${outputPath}`);

  // Print summary
  printSummary(results);
}

function getDetectedSections(parsedCV: any) {
  const sections = [];
  if (parsedCV.education.length > 0) sections.push('EDUCATION');
  if (parsedCV.experience.length > 0) sections.push('EXPERIENCE');
  if (parsedCV.projects.length > 0) sections.push('PROJECTS');
  if (parsedCV.skills.technical.length + parsedCV.skills.programming.length + 
      parsedCV.skills.tools.length + parsedCV.skills.software.length + 
      parsedCV.skills.domain.length + parsedCV.skills.soft.length > 0) {
    sections.push('SKILLS');
  }
  if (parsedCV.certifications.length > 0) sections.push('CERTIFICATIONS');
  if (parsedCV.achievements.length > 0) sections.push('ACHIEVEMENTS');
  return sections;
}

function detectSuspiciousRecords(parsedCV: any) {
  const suspicious = [];
  
  // Check education for suspicious patterns
  if (parsedCV.education.length > 5) {
    suspicious.push(`EDUCATION_COUNT_HIGH: ${parsedCV.education.length} education records`);
  }
  
  // Check for duplicate education records
  const eduInstitutions = parsedCV.education.map((e: any) => e.institution.toLowerCase().trim());
  const eduDuplicates = eduInstitutions.filter((item: string, index: number) => eduInstitutions.indexOf(item) !== index);
  if (eduDuplicates.length > 0) {
    suspicious.push(`EDUCATION_DUPLICATE_INSTITUTIONS: ${eduDuplicates.length} duplicate institutions`);
  }
  
  // Check experience for suspicious patterns
  if (parsedCV.experience.length > 10) {
    suspicious.push(`EXPERIENCE_COUNT_HIGH: ${parsedCV.experience.length} experience records`);
  }
  
  // Check for duplicate experience records
  const expOrganizations = parsedCV.experience.map((e: any) => e.organization.toLowerCase().trim());
  const expDuplicates = expOrganizations.filter((item: string, index: number) => expOrganizations.indexOf(item) !== index);
  if (expDuplicates.length > 0) {
    suspicious.push(`EXPERIENCE_DUPLICATE_ORGANIZATIONS: ${expDuplicates.length} duplicate organizations`);
  }
  
  // Check for field carryover
  if (parsedCV.education.length > 1) {
    const firstEdu = parsedCV.education[0];
    let allSame = true;
    for (const edu of parsedCV.education.slice(1)) {
      if (edu.major !== firstEdu.major || 
          edu.cgpa !== firstEdu.cgpa || 
          edu.startYear !== firstEdu.startYear ||
          edu.endYear !== firstEdu.endYear) {
        allSame = false;
        break;
      }
    }
    if (allSame && firstEdu.major) {
      suspicious.push(`FIELD_CARRYOVER_EDUCATION: All ${parsedCV.education.length} education records have identical major/cgpa/years`);
    }
  }
  
  return suspicious;
}

function printSummary(results: any[]) {
  console.log('\n' + '='.repeat(80));
  console.log('STRESS PACK TEST SUMMARY');
  console.log('='.repeat(80));
  
  const total = results.length;
  const success = results.filter(r => r.parseOutcome === 'SUCCESS').length;
  const failed = results.filter(r => r.parseOutcome !== 'SUCCESS').length;
  
  console.log(`TOTAL FILES: ${total}`);
  console.log(`SUCCESS: ${success}`);
  console.log(`FAILED: ${failed}`);
  console.log(`PASS RATE: ${((success/total)*100).toFixed(1)}%`);
  
  console.log('\n--- BY FORMAT ---');
  const pdfResults = results.filter(r => r.file.endsWith('.pdf'));
  const docxResults = results.filter(r => r.file.endsWith('.docx'));
  
  console.log(`PDF: ${pdfResults.filter(r => r.parseOutcome === 'SUCCESS').length}/${pdfResults.length} (${((pdfResults.filter(r => r.parseOutcome === 'SUCCESS').length/pdfResults.length)*100).toFixed(1)}%)`);
  console.log(`DOCX: ${docxResults.filter(r => r.parseOutcome === 'SUCCESS').length}/${docxResults.length} (${((docxResults.filter(r => r.parseOutcome === 'SUCCESS').length/docxResults.length)*100).toFixed(1)}%)`);
  
  console.log('\n--- DETAILED RESULTS ---');
  for (const r of results) {
    console.log(`\n${r.file}:`);
    console.log(`  Hash: ${r.hash.substring(0, 16)}...`);
    console.log(`  Size: ${r.size} bytes`);
    console.log(`  Outcome: ${r.parseOutcome}`);
    console.log(`  Strategy: ${r.extractionStrategy}`);
    console.log(`  Sections: ${r.detectedSections.join(', ') || 'NONE'}`);
    console.log(`  Education: ${r.education}`);
    console.log(`  Experience: ${r.experience}`);
    console.log(`  Projects: ${r.projects}`);
    console.log(`  Skills: ${Object.values(r.skills).reduce((a,b)=>a+b,0)}`);
    console.log(`  Certifications: ${r.certifications}`);
    console.log(`  Achievements: ${r.achievements}`);
    if (r.warnings.length) console.log(`  Warnings: ${r.warnings.join('; ')}`);
    if (r.suspiciousRecords.length) console.log(`  Suspicious: ${r.suspiciousRecords.join('; ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });