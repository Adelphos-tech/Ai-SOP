// ============================================================
// PHASE SOP-INFRA-36: Load test database seeder
// Seeds sop_ai_app_loadtest with synthetic data:
//   500 students, 2 apps/student, 3 docs/app, 2-3 versions/doc
// ============================================================

const mysql = require("mysql2/promise");
const crypto = require("crypto");

const DB_CONFIG = {
  host: "127.0.0.1",
  port: 3306,
  user: "sop_app",
  password: process.env.SOP_PROD_DB_PASSWORD || "",
  database: "sop_ai_app_loadtest",
  charset: "utf8mb4",
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(36) PRIMARY KEY,
  external_ref_id VARCHAR(255) DEFAULT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(500) NOT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  country VARCHAR(100) DEFAULT NULL,
  profile_data JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_students_email (email),
  INDEX idx_students_name (last_name, first_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  university_name VARCHAR(500) NOT NULL,
  program_name VARCHAR(500) NOT NULL,
  degree VARCHAR(255) NOT NULL,
  department VARCHAR(500) DEFAULT NULL,
  country VARCHAR(100) NOT NULL,
  intake VARCHAR(100) NOT NULL,
  intake_year VARCHAR(10) NOT NULL,
  application_context_id VARCHAR(255) DEFAULT NULL,
  requirement_set_id VARCHAR(36) DEFAULT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_applications_student (student_id),
  INDEX idx_applications_university (university_name),
  INDEX idx_applications_status (status),
  INDEX idx_applications_reqset (requirement_set_id),
  CONSTRAINT fk_applications_student FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_documents (
  id VARCHAR(36) PRIMARY KEY,
  application_id VARCHAR(36) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  document_title VARCHAR(500) NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_source VARCHAR(50) NOT NULL,
  word_min INT DEFAULT NULL,
  word_max INT DEFAULT NULL,
  character_limit INT DEFAULT NULL,
  page_limit INT DEFAULT NULL,
  special_instructions TEXT DEFAULT NULL,
  faculty_instructions TEXT DEFAULT NULL,
  formatting_instructions TEXT DEFAULT NULL,
  writing_requirement_id VARCHAR(36) DEFAULT NULL,
  requirements_status VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
  generation_status VARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
  generation_started_at TIMESTAMP NULL DEFAULT NULL,
  review_status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  current_version_id VARCHAR(36) DEFAULT NULL,
  approved_version_id VARCHAR(36) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_documents_application (application_id),
  INDEX idx_documents_type (document_type),
  INDEX idx_documents_status (generation_status),
  INDEX idx_documents_review_status (review_status),
  INDEX idx_documents_writreq (writing_requirement_id),
  CONSTRAINT fk_documents_application FOREIGN KEY (application_id)
    REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_versions (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) NOT NULL,
  version_number INT NOT NULL,
  content LONGTEXT NOT NULL,
  content_format VARCHAR(20) NOT NULL DEFAULT 'MARKDOWN',
  created_by_type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
  parent_version_id VARCHAR(36) DEFAULT NULL,
  model VARCHAR(100) DEFAULT NULL,
  generation_id VARCHAR(255) DEFAULT NULL,
  student_facts_hash VARCHAR(255) DEFAULT NULL,
  requirements_hash VARCHAR(255) DEFAULT NULL,
  cost_usd DECIMAL(10, 6) DEFAULT NULL,
  cost_inr DECIMAL(10, 2) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_versions_document (document_id),
  INDEX idx_versions_number (document_id, version_number),
  INDEX idx_versions_parent (parent_version_id),
  UNIQUE KEY uq_versions_doc_number (document_id, version_number),
  CONSTRAINT fk_versions_document FOREIGN KEY (document_id)
    REFERENCES application_documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const FIRST_NAMES = ["Aarav","Vivaan","Aditya","Vihaan","Arjun","Sai","Reyansh","Ayaan","Krishna","Ishaan","Ananya","Aadhya","Aaradhya","Aanya","Diya","Kiara","Pari","Saanvi","Riya","Sara"];
const LAST_NAMES = ["Sharma","Verma","Patel","Gupta","Singh","Kumar","Mehta","Joshi","Reddy","Nair","Iyer","Kapoor","Malhotra","Chopra","Bose","Das","Rao","Pillai","Menon","Shah"];
const UNIVERSITIES = ["MIT","Stanford","Harvard","Oxford","Cambridge","ETH Zurich","TU Munich","NUS","Toronto","Melbourne","Carnegie Mellon","Caltech","Berkeley","Yale","Princeton","Columbia","Cornell","Chicago","Imperial","EPFL"];
const PROGRAMS = ["MS Computer Science","MS Data Science","MS Artificial Intelligence","MBA","MS Robotics","MS Cybersecurity","MS Software Engineering","MS Bioinformatics","MS Cloud Computing","MS Business Analytics"];
const DEGREES = ["MS","MEng","MBA","MSc"];
const INTAKES = ["Fall","Spring","Summer"];
const COUNTRIES = ["USA","UK","Germany","Singapore","Canada","Australia","Switzerland","Netherlands","Sweden","Ireland"];
const DOC_TYPES = ["STATEMENT_OF_PURPOSE","PERSONAL_STATEMENT","DIVERSITY_STATEMENT","RESEARCH_STATEMENT","LEADERSHIP_ESSAY"];

function uuid() { return crypto.randomUUID(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function main() {
  const pool = mysql.createPool({ ...DB_CONFIG, connectionLimit: 5, multipleStatements: true });
  const conn = await pool.getConnection();

  console.log("Creating schema...");
  await conn.query(SCHEMA_SQL);

  console.log("Seeding 500 students + 2 apps each + 3 docs each + 2-3 versions each...");

  const STUDENT_COUNT = 500;
  const APPS_PER_STUDENT = 2;
  const DOCS_PER_APP = 3;
  const VERSIONS_PER_DOC_MIN = 2;
  const VERSIONS_PER_DOC_MAX = 3;

  let studentCount = 0, appCount = 0, docCount = 0, versionCount = 0;

  for (let s = 0; s < STUDENT_COUNT; s++) {
    const studentId = uuid();
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${s}@loadtest.example.com`;
    const profileData = JSON.stringify({
      education: [{ degree: "BTech", institution: "IIT Bombay", year: "2023" }],
      experience: [{ role: "Software Engineer", company: "Tech Corp", years: 2 }],
      englishProficiency: { testType: "IELTS", overall: "7.5", writing: "7.0" },
      writingPreferences: { sopWritingProfile: { level: "Natural Professional" } },
    });

    await conn.execute(
      `INSERT INTO students (id, first_name, last_name, email, phone, country, profile_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [studentId, firstName, lastName, email, "+91-90000-00000", pick(COUNTRIES), profileData],
    );
    studentCount++;

    for (let a = 0; a < APPS_PER_STUDENT; a++) {
      const appId = uuid();
      const uni = pick(UNIVERSITIES);
      const prog = pick(PROGRAMS);
      await conn.execute(
        `INSERT INTO applications (id, student_id, university_name, program_name, degree, country, intake, intake_year, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
        [appId, studentId, uni, prog, pick(DEGREES), pick(COUNTRIES), pick(INTAKES), "2025"],
      );
      appCount++;

      for (let d = 0; d < DOCS_PER_APP; d++) {
        const docId = uuid();
        const docType = pick(DOC_TYPES);
        const promptText = `Write a ${docType.replace(/_/g, " ")} for ${prog} at ${uni}. Explain your motivation, background, and goals.`;
        await conn.execute(
          `INSERT INTO application_documents
           (id, application_id, document_type, document_title, prompt_text, prompt_source, word_min, word_max, generation_status, review_status)
           VALUES (?, ?, ?, ?, ?, 'MANUAL', 500, 1000, 'GENERATED', 'DRAFT')`,
          [docId, appId, docType, `${docType.replace(/_/g, " ")} - ${uni}`, promptText],
        );
        docCount++;

        const versionCount_ = VERSIONS_PER_DOC_MIN + Math.floor(Math.random() * (VERSIONS_PER_DOC_MAX - VERSIONS_PER_DOC_MIN + 1));
        let currentVersionId = null;
        for (let v = 1; v <= versionCount_; v++) {
          const versionId = uuid();
          const content = `# ${docType.replace(/_/g, " ")}\n\nVersion ${v} for ${prog} at ${uni}.\n\nThis is synthetic load test content for student ${firstName} ${lastName}.\n`.repeat(50);
          await conn.execute(
            `INSERT INTO document_versions
             (id, document_id, version_number, content, content_format, created_by_type, model)
             VALUES (?, ?, ?, ?, 'MARKDOWN', ?, 'gpt-4o-mini')`,
            [versionId, docId, v, content, v === 1 ? "AI_GENERATED" : "CONSULTANT_EDITED"],
          );
          versionCount++;
          if (v === versionCount_) currentVersionId = versionId;
        }
        if (currentVersionId) {
          await conn.execute(
            "UPDATE application_documents SET current_version_id = ? WHERE id = ?",
            [currentVersionId, docId],
          );
        }
      }
    }

    if ((s + 1) % 50 === 0) {
      console.log(`  Seeded ${s + 1}/${STUDENT_COUNT} students...`);
    }
  }

  console.log(`\nSeeding complete:`);
  console.log(`  Students: ${studentCount}`);
  console.log(`  Applications: ${appCount}`);
  console.log(`  Documents: ${docCount}`);
  console.log(`  Versions: ${versionCount}`);

  // Verify counts
  const [sCount] = await conn.execute("SELECT COUNT(*) AS c FROM students");
  const [aCount] = await conn.execute("SELECT COUNT(*) AS c FROM applications");
  const [dCount] = await conn.execute("SELECT COUNT(*) AS c FROM application_documents");
  const [vCount] = await conn.execute("SELECT COUNT(*) AS c FROM document_versions");
  console.log(`\nDB verification:`);
  console.log(`  students: ${sCount[0].c}`);
  console.log(`  applications: ${aCount[0].c}`);
  console.log(`  documents: ${dCount[0].c}`);
  console.log(`  versions: ${vCount[0].c}`);

  conn.release();
  await pool.end();
  console.log("\nDone.");
}

main().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
