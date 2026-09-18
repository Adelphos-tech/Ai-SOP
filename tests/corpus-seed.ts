/**
 * @file corpus-seed.ts
 * @description
 * Seeds sop_ai_app_test with copies of real production profiles and
 * documents across document types for the validation corpus.
 *
 * Reads prod (sop_ai_app) profiles via a direct mysql connection and
 * writes students/applications/documents into the TEST database only.
 *
 * Run: SOP_DB_* -> prod read, TEST_DB_* -> test write
 *   npx tsx tests/corpus-seed.ts
 */

import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const PROD = {
  host: "127.0.0.1", port: 3306,
  user: process.env.SOP_PROD_DB_USER || "sop_app",
  password: process.env.SOP_PROD_DB_PASSWORD || "",
  database: "sop_ai_app",
};
const TEST = {
  host: "127.0.0.1", port: 3306,
  user: process.env.SOP_TEST_DB_USER || "sop_test",
  password: process.env.SOP_TEST_DB_PASSWORD || "",
  database: "sop_ai_app_test",
};

// The 4 real profiles to clone (prod student IDs)
const SOURCE_STUDENTS = [
  "45e4a41d-9940-4dc8-8b59-22683a0efb9c", // Moksh — rich
];

async function main() {
  const prod = await mysql.createConnection(PROD);
  const test = await mysql.createConnection(TEST);

  // Discover all prod students that have a real profile
  const [students] = await prod.execute(
    "SELECT id, first_name, last_name, email, phone, country, profile_data FROM students WHERE profile_data IS NOT NULL AND LENGTH(profile_data) > 2000"
  );
  console.log(`Found ${(students as any[]).length} students with real profiles`);

  const corpus: Array<{ studentId: string; applicationId: string; documentId: string; type: string; label: string }> = [];

  // Document plan: type per source profile
  const docPlan: Array<{ type: string; title: string }> = [
    { type: "STATEMENT_OF_PURPOSE", title: "Statement of Purpose" },
    { type: "PERSONAL_STATEMENT", title: "Personal Statement" },
    { type: "STATEMENT_OF_ACADEMIC_PURPOSE", title: "Statement of Academic Purpose" },
    { type: "LETTER_OF_MOTIVATION", title: "Letter of Motivation" },
    { type: "VISA_SOP", title: "Visa SOP" },
    { type: "COVER_LETTER", title: "Cover Letter" },
    { type: "ESSAY", title: "Essay" },
    { type: "SUPPLEMENTAL_QUESTION", title: "Supplemental Question" },
    { type: "LETTER_OF_RECOMMENDATION", title: "Letter of Recommendation" },
    { type: "CUSTOM", title: "Custom Document" },
  ];

  const defaultPrompt = "Write a statement describing your background, preparation, motivation, and goals for graduate study.";

  for (const s of students as any[]) {
    const studentId = s.id;
    // Clone student row into test DB (upsert by id)
    await test.execute(
      `INSERT INTO students (id, first_name, last_name, email, phone, country, profile_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_data = VALUES(profile_data)`,
      [studentId, s.first_name, s.last_name, s.email, s.phone, s.country, s.profile_data]
    );

    // One application per student in test DB
    const applicationId = randomUUID();
    await test.execute(
      `INSERT INTO applications (id, student_id, university_name, program_name, degree, country, intake, intake_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [applicationId, studentId, "Corpus University", "MS Computer Science", "Master of Science", "United States", "Fall", "2027"]
    );

    for (const d of docPlan) {
      const documentId = randomUUID();
      await test.execute(
        `INSERT INTO application_documents (id, application_id, document_type, document_title, prompt_text, prompt_source, generation_status, review_status)
         VALUES (?, ?, ?, ?, ?, 'CONSULTANT_PROVIDED', 'NOT_STARTED', 'PENDING')`,
        [documentId, applicationId, d.type, d.title, defaultPrompt]
      );
      corpus.push({ studentId, applicationId, documentId, type: d.type, label: `${s.first_name} ${d.type}` });
    }
  }

  console.log(`\nSeeded ${corpus.length} documents:`);
  for (const c of corpus) console.log(`  ${c.type} | ${c.documentId} | ${c.label}`);
  console.log(`\nCorpus manifest:`);
  console.log(JSON.stringify(corpus, null, 2));

  await prod.end();
  await test.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
