// ============================================================
// BENCHMARK FIXTURE GENERATOR
// ============================================================
// Generates synthetic resumes (format variety) + failure fixtures
// into test-output/affinda/fixtures/ (gitignored).
// Synthetic identities use example.com / 555 numbers — no real PII.
// Usage: npx tsx scripts/affinda-benchmark/generate-fixtures.ts
// ============================================================

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const OUT = join(process.cwd(), "test-output", "affinda", "fixtures");
mkdirSync(OUT, { recursive: true });

// ---------- DOCX helpers ----------
const p = (text: string, bold = false) =>
  new Paragraph({ children: [new TextRun({ text, bold })] });

async function writeDocx(name: string, children: any[]) {
  const doc = new Document({ sections: [{ children }] });
  writeFileSync(join(OUT, name), await Packer.toBuffer(doc));
  console.log(`wrote ${name}`);
}

// ---------- PDF helpers ----------
async function writePdf(name: string, draw: (ctx: PdfCtx) => void) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ctx: PdfCtx = { page, font, bold };
  draw(ctx);
  writeFileSync(join(OUT, name), await pdf.save());
  console.log(`wrote ${name}`);
}

interface PdfCtx {
  page: import("pdf-lib").PDFPage;
  font: import("pdf-lib").PDFFont;
  bold: import("pdf-lib").PDFFont;
}

function line(ctx: PdfCtx, x: number, y: number, text: string, size = 10, bold = false) {
  ctx.page.drawText(text, { x, y, size, font: bold ? ctx.bold : ctx.font, color: rgb(0, 0, 0) });
}

// ---------- fixtures ----------

async function main() {
  // --- synth-table.docx : pure table layout, no Word heading styles ---
  const cell = (t: string, bold = false) =>
    new TableCell({
      children: [p(t, bold)],
      borders: {
        top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      },
    });
  const row = (...cells: TableCell[]) => new TableRow({ children: cells });
  await writeDocx("synth-table.docx", [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        row(cell("PRIYA RAMESH", true)),
        row(cell("priya.ramesh@example.com | +1 555 014 2233 | linkedin.com/in/priya-ramesh-example | Austin, TX")),
        row(cell("EXPERIENCE", true)),
        row(cell("Clinical Data Intern", true), cell("JULY/2022 - DEC/2022")),
        row(cell("MedData Analytics, Austin TX")),
        row(cell("Cleaned EDC datasets; ran SDTM mapping checks.")),
        row(cell("Regulatory Affairs Clerk", true), cell("JAN/2023 - JUN/2023")),
        row(cell("HealthBridge Services, Remote")),
        row(cell("Prepared IND submission checklists.")),
        row(cell("EDUCATION", true)),
        row(cell("BS Biology, University of Texas at Austin", true), cell("2019 - 2023")),
        row(cell("GPA: 3.7/4.0")),
        row(cell("SKILLS", true)),
        row(cell("SQL, SAS, EDC systems, GCP compliance")),
        row(cell("PUBLICATIONS", true)),
        row(cell("Ramesh P. 'SDTM automation patterns', ClinData Journal 2024")),
        row(cell("LANGUAGES", true)),
        row(cell("English, Tamil, Hindi")),
      ],
    }),
  ]);

  // --- synth-academic.docx : publications / research / teaching ---
  await writeDocx("synth-academic.docx", [
    p("DR. MARCUS ELLISON", true),
    p("m.ellison@example.edu | +1 555 010 8899 | Boston, MA | linkedin.com/in/marcus-ellison-example"),
    p(""),
    p("EDUCATION", true),
    p("PhD Computational Biology, MIT, Cambridge MA — 2015 - 2020"),
    p("BS Molecular Biology, Tufts University — 2011 - 2015, GPA 3.9/4.0"),
    p(""),
    p("ACADEMIC APPOINTMENTS", true),
    p("Assistant Professor, Boston University — Sep 2021 - Present"),
    p("Postdoctoral Fellow, Harvard Medical School — Jul 2020 - Aug 2021"),
    p(""),
    p("RESEARCH", true),
    p("PI on NSF grant 'Single-cell atlas of tumor microenvironment' ($420k, 2023-2026)."),
    p(""),
    p("PUBLICATIONS", true),
    p("Ellison M. et al. 'scRNA-seq deconvolution at scale', Nature Methods 2023."),
    p("Ellison M., Chen R. 'Tumor microenvironment atlases', Cell Systems 2022."),
    p(""),
    p("TEACHING", true),
    p("BIO 510 Computational Genomics (Fall 2022, 2023, 2024)"),
    p(""),
    p("VOLUNTEER WORK", true),
    p("Mentor, Boston Bioinformatics Outreach Program — 2022 - Present"),
    p(""),
    p("SKILLS", true),
    p("Python, R, Nextflow, AWS, scRNA-seq, statistical modeling"),
  ]);

  // --- synth-fresher.docx ---
  await writeDocx("synth-fresher.docx", [
    p("ANA DESOUZA", true),
    p("ana.desouza@example.com | +91 95550 12345 | Goa, India"),
    p(""),
    p("EDUCATION", true),
    p("B.E. Computer Engineering, Goa College of Engineering — 2021 - 2025, CGPA 8.9/10"),
    p("12th Grade, Vidya Higher Secondary School — 2021, 92%"),
    p("10th Grade, Vidya High School — 2019, 94%"),
    p(""),
    p("PROJECTS", true),
    p("Campus Event App — React Native, Firebase"),
    p("Library Seat Booker — Next.js, PostgreSQL"),
    p(""),
    p("SKILLS", true),
    p("Java, Python, React, SQL, Git"),
    p(""),
    p("ACHIEVEMENTS", true),
    p("Smart India Hackathon finalist 2024"),
    p("Department topper, 3rd year"),
  ]);

  // --- failure fixtures ---
  writeFileSync(join(OUT, "corrupt.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55]));
  console.log("wrote corrupt.docx");

  await writeDocx("blank.docx", [p("")]);

  await writeDocx("sparse.docx", [
    p("JOHN Q SAMPLE", true),
    p("john.q.sample@example.com"),
  ]);

  // --- blank.pdf ---
  {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    writeFileSync(join(OUT, "blank.pdf"), await pdf.save());
    console.log("wrote blank.pdf");
  }

  // --- synth-twocol.pdf : left sidebar (contact+skills) + main column ---
  await writePdf("synth-twocol.pdf", (ctx) => {
    // sidebar
    line(ctx, 30, 750, "ELENA KOSTOVA", 16, true);
    line(ctx, 30, 720, "CONTACT", 10, true);
    line(ctx, 30, 705, "elena.kostova@example.com");
    line(ctx, 30, 692, "+1 555 011 7788");
    line(ctx, 30, 679, "Seattle, WA");
    line(ctx, 30, 666, "linkedin.com/in/elena-kostova-example");
    line(ctx, 30, 640, "SKILLS", 10, true);
    ["Python", "Kubernetes", "Terraform", "CI/CD", "Observability"].forEach((t, i) =>
      line(ctx, 30, 625 - i * 13, `• ${t}`));
    line(ctx, 30, 540, "LANGUAGES", 10, true);
    ["English", "Bulgarian", "German"].forEach((t, i) => line(ctx, 30, 525 - i * 13, `• ${t}`));
    // main column
    line(ctx, 220, 720, "EXPERIENCE", 10, true);
    line(ctx, 220, 705, "Senior DevOps Engineer — CloudWorks Inc", 10, true);
    line(ctx, 220, 692, "Mar 2021 - Present | Seattle, WA");
    line(ctx, 220, 679, "• Led migration of 200+ services to Kubernetes");
    line(ctx, 220, 666, "• Cut deploy time 60% via GitOps pipelines");
    line(ctx, 220, 640, "DevOps Engineer — NetScale", 10, true);
    line(ctx, 220, 627, "Jun 2018 - Feb 2021 | Portland, OR");
    line(ctx, 220, 614, "• Maintained AWS infra for 40M req/day");
    line(ctx, 220, 580, "EDUCATION", 10, true);
    line(ctx, 220, 565, "BS Computer Science, University of Washington", 10, true);
    line(ctx, 220, 552, "2014 - 2018");
    line(ctx, 220, 525, "CERTIFICATIONS", 10, true);
    line(ctx, 220, 510, "AWS Solutions Architect Professional (2022)");
    line(ctx, 220, 497, "CKA — Certified Kubernetes Administrator (2021)");
  });

  // --- synth-singlecol.pdf : experienced finance professional ---
  await writePdf("synth-singlecol.pdf", (ctx) => {
    let y = 750;
    const ln = (t: string, size = 10, bold = false, gap = 14) => { line(ctx, 50, y, t, size, bold); y -= gap; };
    ln("DAVID OKONKWO", 16, true, 20);
    ln("david.okonkwo@example.com | +44 5550 123 456 | London, UK");
    ln("linkedin.com/in/david-okonkwo-example", 10, false, 22);
    ln("PROFESSIONAL EXPERIENCE", 11, true);
    ln("Senior Financial Analyst — Meridian Capital — London", 10, true);
    ln("Apr 2020 - Present");
    ln("• Built valuation models for £300M M&A pipeline");
    ln("• Led quarterly board reporting package");
    ln("Financial Analyst — Hartwell Group — Manchester", 10, true, 16);
    ln("Jun 2016 - Mar 2020");
    ln("• Automated month-end close, saving 3 days/cycle");
    ln("", 10, false, 20);
    ln("EDUCATION", 11, true);
    ln("MSc Finance, London School of Economics — 2015 - 2016");
    ln("BSc Economics, University of Manchester — 2012 - 2015, First Class");
    ln("", 10, false, 20);
    ln("CERTIFICATIONS", 11, true);
    ln("CFA Level III (2023) | FRM (2021)");
    ln("", 10, false, 20);
    ln("SKILLS", 11, true);
    ln("Financial modeling, Excel, Python, Bloomberg, SQL, Tableau");
  });

  // --- synth-healthcare.pdf : Pharm-D style healthcare CV ---
  await writePdf("synth-healthcare.pdf", (ctx) => {
    let y = 750;
    const ln = (t: string, size = 10, bold = false, gap = 14) => { line(ctx, 50, y, t, size, bold); y -= gap; };
    ln("SARA MULLER, PHARMD", 16, true, 20);
    ln("sara.muller@example.com | +1 555 019 3344 | Chicago, IL");
    ln("", 10, false, 20);
    ln("CLINICAL EXPERIENCE", 11, true);
    ln("Clinical Pharmacist — Rush University Medical Center", 10, true);
    ln("Jul 2022 - Present | Chicago, IL");
    ln("• ICU rounds; antibiotic stewardship program co-lead");
    ln("Pharmacy Intern — CVS Health", 10, true, 16);
    ln("May 2020 - Jun 2022 | Chicago, IL");
    ln("• Dispensing verification; immunization clinic support");
    ln("", 10, false, 20);
    ln("EDUCATION", 11, true);
    ln("PharmD, University of Illinois Chicago — 2018 - 2022");
    ln("BS Biochemistry, Loyola University Chicago — 2014 - 2018");
    ln("", 10, false, 20);
    ln("LICENSES & CERTIFICATIONS", 11, true);
    ln("Illinois Pharmacist License #051.302999 (2022)");
    ln("BCPS — Board Certified Pharmacotherapy Specialist (2024)");
    ln("APhA Immunization Certification (2020)");
    ln("", 10, false, 20);
    ln("RESEARCH & PUBLICATIONS", 11, true);
    ln("Muller S. et al. 'Vancomycin dosing in obesity', Am J Health-Syst Pharm 2024");
    ln("", 10, false, 20);
    ln("LANGUAGES", 11, true);
    ln("English, German, Spanish");
  });

  console.log(`\nFixtures written to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
