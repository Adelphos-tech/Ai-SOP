# D-VIVID Complex Resume Parser Stress Pack

All resumes are synthetic QA fixtures. No real-person personal data is used.

## Manual test method
For each file: upload once, verify section counts/content, then upload the same file again to verify cache reuse does not change parsed results. For scanned/mixed PDFs, confirm OCR provenance/notice is appropriate when the pipeline uses OCR.

## Pass rule
A file passes only if expected real records are present, listed must-not-create items do not appear in the wrong structured sections, and repeated upload returns the same structured output.

### 01_dense_two_column_product_analyst.pdf
- Type: PDF, dense two-column/sidebar
- Expected counts: education=2, experience=3, projects=2, certifications=2
- Stress: two-column reading order; sidebar; dense layout; multiple jobs
- Must NOT create: Sidebar labels as records; Skills as education; Contact lines as experience

### 02_table_heavy_program_manager.docx
- Type: DOCX, tables, 2 pages
- Expected counts: education=2, experience=3, projects=3, certifications=3
- Stress: DOCX tables; page break; education table; experience table
- Must NOT create: Table headers as records; capability cells as jobs

### 03_indian_education_substring_traps.pdf
- Type: PDF, India education + substring traps
- Expected counts: education=4, experience=0, projects=6, certifications=0
- Stress: BE/ME/MIT/NIT/VIT substring traps; 10th/12th; Diploma; B.Tech; Percentage hyphen; section termination
- Must NOT create: Time-series; Debentures; Activities tracker; Community portal; Limits and differentiation; Save Girl Child; SUBJECTS KNOWN lines

### 04_senior_executive_multi_role.pdf
- Type: PDF, senior executive, repeated employer/overlapping roles
- Expected counts: education=3, experience=5, projects=4, certifications=2
- Stress: long career; same employer multiple roles; multi-page; executive content
- Must NOT create: Board/advisory entries as education; initiative names as jobs

### 05_academic_research_cv.docx
- Type: DOCX, academic CV
- Expected counts: education=4, experience=3, publications=5, certifications=0
- Stress: academic CV; publications; teaching; grants; many years
- Must NOT create: Publications as education; conference titles as institutions; teaching modules as degrees

### 06_no_education_content_designer.pdf
- Type: PDF, intentionally no education
- Expected counts: education=0, experience=3, projects=3, certifications=2
- Stress: zero-education precision; education-like phrases outside education
- Must NOT create: University admissions project as education; Mastering limits project as degree

### 07_unusual_headings_cybersecurity.docx
- Type: DOCX, unusual section headings
- Expected counts: education=2, experience=4, projects=2, certifications=2
- Stress: SCHOLASTIC RECORD; CAREER JOURNEY; PROOF OF WORK; CREDENTIALS; mixed date formats
- Must NOT create: MITRE ATT&CK skill as institution; tool names as education

### 08_scanned_image_only_quality_engineer.pdf
- Type: PDF, image-only two-page scan
- Expected counts: education=2, experience=2, projects=2, certifications=2
- Stress: OCR; image-only PDF; slight skew; two pages
- Must NOT create: Skill acronyms as education

### 09_mixed_text_scan_solutions_architect.pdf
- Type: PDF, mixed text page + scanned education page
- Expected counts: education=2, experience=3, certifications=2
- Stress: mixed text/image PDF; OCR on second page; cross-page section recovery
- Must NOT create: Cloud vendor names as institutions

### 10_repeated_header_footer_product_ops.docx
- Type: DOCX, repeated header/footer + page break
- Expected counts: education=2, experience=5, projects=3, certifications=2
- Stress: repeated headers; repeated footers; tables; unusual Academic Background heading; multi-page
- Must NOT create: 2026 header as job/date; footer trap words as sections; Volunteer Activities as education

