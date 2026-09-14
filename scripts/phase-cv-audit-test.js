// ============================================================
// CV UPLOAD FEATURE — COMPREHENSIVE AUDIT TEST
// ============================================================
// Tests parser accuracy, API security, edge cases, and data flow.
// No OpenAI calls. No paid APIs.
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:5010";

function makeRequest(pathStr, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const h = { "Content-Type": "application/json", ...headers };
    const req = http.request(`${BASE}${pathStr}`, { method, headers: h }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeFormDataRequest(pathStr, formDataBuffer, boundary) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}${pathStr}`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": formDataBuffer.length,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    req.write(formDataBuffer);
    req.end();
  });
}

function buildFormData(fields) {
  const boundary = "----FormBoundary" + Date.now();
  let parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    } else if (value.file) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.filename}"\r\nContent-Type: ${value.contentType || "application/octet-stream"}\r\n\r\n${value.file}\r\n`);
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return { buffer: Buffer.from(parts.join("")), boundary };
}

async function main() {
  console.log("=".repeat(60));
  console.log("CV UPLOAD FEATURE — COMPREHENSIVE AUDIT");
  console.log("=".repeat(60));

  let passed = 0, failed = 0, warnings = 0;
  function assert(cond, name) {
    if (cond) { console.log(`  PASS: ${name}`); passed++; }
    else { console.log(`  FAIL: ${name}`); failed++; }
  }
  function warn(cond, name) {
    if (!cond) { console.log(`  WARN: ${name}`); warnings++; }
    else { console.log(`  PASS: ${name}`); passed++; }
  }

  // ===== Create test student =====
  const studentEmail = `cvaudit-${Date.now()}@dvivid.test`;
  const createRes = await makeRequest("/api/application/save", "POST", JSON.stringify({
    student: { firstName: "CVAudit", lastName: "Test", email: studentEmail },
    application: { universityName: "MIT", programName: "MS CS", degree: "MS" },
    document: { documentType: "STATEMENT_OF_PURPOSE", documentTitle: "SOP", promptText: "Test", promptSource: "CONSULTANT_PROVIDED" },
  }));
  const studentId = createRes.data.student?.id;
  assert(!!studentId, "Test student created");

  // ============================================================
  console.log("\n--- 1. PARSER ACCURACY: Well-formatted CV ---");
  // ============================================================
  const goodCV = `Shivang Singh
Mumbai, India
shivang.singh@example.com | +91-98765-43210 | linkedin.com/in/shivangsingh

EDUCATION
B.Tech in Computer Science, IIT Bombay
2019 - 2023
CGPA: 9.2/10

EXPERIENCE
Software Engineering Intern at Google
June 2022 - August 2022
- Built internal tools for data pipeline

PROJECTS
ML Stock Predictor
- Built a stock prediction model using LSTM
- Technologies: Python, TensorFlow

SKILLS
Programming: Python, Java, C++
Tools: Git, Docker, AWS
`;

  const { buffer: goodBuf, boundary: goodBoundary } = buildFormData({
    file: { file: goodCV, filename: "test_good.txt", contentType: "text/plain" },
    studentId,
  });
  const goodRes = await makeFormDataRequest("/api/application/cv-upload", goodBuf, goodBoundary);
  assert(goodRes.status === 200, "Well-formatted CV: upload succeeds");
  const goodParsed = goodRes.data.parsed;
  assert(goodParsed?.personalData?.firstName === "Shivang", "Well-formatted CV: name detected");
  assert(goodParsed?.personalData?.email === "shivang.singh@example.com", "Well-formatted CV: email detected");
  assert(goodParsed?.personalData?.phone === "+91-98765-43210", "Well-formatted CV: phone detected");
  assert(goodParsed?.personalData?.currentCity === "Mumbai", "Well-formatted CV: city detected");
  assert(goodParsed?.education?.length === 1, `Well-formatted CV: education detected (${goodParsed?.education?.length} records)`);
  assert(goodParsed?.education?.[0]?.institution === "IIT Bombay", "Well-formatted CV: institution detected");
  assert(goodParsed?.projects?.length === 1, `Well-formatted CV: projects detected (${goodParsed?.projects?.length} records)`);
  assert(goodParsed?.skills?.programming?.includes("Python"), "Well-formatted CV: programming skills detected");

  // ============================================================
  console.log("\n--- 2. PARSER EDGE CASES ---");
  // ============================================================

  // Empty file
  const { buffer: emptyBuf, boundary: emptyBoundary } = buildFormData({
    file: { file: "", filename: "empty.txt", contentType: "text/plain" },
    studentId,
  });
  const emptyRes = await makeFormDataRequest("/api/application/cv-upload", emptyBuf, emptyBoundary);
  assert(emptyRes.status === 500, "Empty file: rejected with 500");
  assert(!!emptyRes.data?.error, "Empty file: error message returned");

  // Very short file (< 50 chars)
  const { buffer: shortBuf, boundary: shortBoundary } = buildFormData({
    file: { file: "Short CV", filename: "short.txt", contentType: "text/plain" },
    studentId,
  });
  const shortRes = await makeFormDataRequest("/api/application/cv-upload", shortBuf, shortBoundary);
  assert(shortRes.status === 500, "Very short file: rejected");

  // No name in CV
  const noNameCV = `email: noname@example.com
phone: +91-1234567890
EDUCATION
B.Tech, IIT Bombay
2019 - 2023
`;
  const { buffer: noNameBuf, boundary: noNameBoundary } = buildFormData({
    file: { file: noNameCV, filename: "noname.txt", contentType: "text/plain" },
    studentId,
  });
  const noNameRes = await makeFormDataRequest("/api/application/cv-upload", noNameBuf, noNameBoundary);
  assert(noNameRes.status === 200, "No-name CV: upload succeeds");
  assert(!noNameRes.data?.parsed?.personalData?.firstName, "No-name CV: name not detected (correct)");
  assert(noNameRes.data?.parsed?.parseWarnings?.some(w => w.includes("name")), "No-name CV: warning about missing name");

  // Non-Western name format
  const nonWesternCV = `Wang Wei
Beijing, China
wang.wei@example.com

EDUCATION
Bachelor in Computer Science, Tsinghua University
2018 - 2022
`;
  const { buffer: nonWesternBuf, boundary: nonWesternBoundary } = buildFormData({
    file: { file: nonWesternCV, filename: "nonwestern.txt", contentType: "text/plain" },
    studentId,
  });
  const nonWesternRes = await makeFormDataRequest("/api/application/cv-upload", nonWesternBuf, nonWesternBoundary);
  assert(nonWesternRes.status === 200, "Non-Western name CV: upload succeeds");
  assert(nonWesternRes.data?.parsed?.personalData?.firstName === "Wang", `Non-Western name: detected (${nonWesternRes.data?.parsed?.personalData?.firstName})`);

  // ============================================================
  console.log("\n--- 3. API SECURITY ---");
  // ============================================================

  // Invalid student ID
  const { buffer: badIdBuf, boundary: badIdBoundary } = buildFormData({
    file: { file: goodCV, filename: "test.txt", contentType: "text/plain" },
    studentId: "nonexistent-student-id",
  });
  const badIdRes = await makeFormDataRequest("/api/application/cv-upload", badIdBuf, badIdBoundary);
  assert(badIdRes.status === 404, "Invalid student ID: rejected with 404");

  // No student ID
  const { buffer: noIdBuf, boundary: noIdBoundary } = buildFormData({
    file: { file: goodCV, filename: "test.txt", contentType: "text/plain" },
    studentId: null,
  });
  const noIdRes = await makeFormDataRequest("/api/application/cv-upload", noIdBuf, noIdBoundary);
  assert(noIdRes.status === 400, "No student ID: rejected with 400");

  // Unsupported file type
  const { buffer: badTypeBuf, boundary: badTypeBoundary } = buildFormData({
    file: { file: "fake content", filename: "malicious.exe", contentType: "application/octet-stream" },
    studentId,
  });
  const badTypeRes = await makeFormDataRequest("/api/application/cv-upload", badTypeBuf, badTypeBoundary);
  assert(badTypeRes.status === 400, "Unsupported file type (.exe): rejected with 400");

  // File with no extension
  const { buffer: noExtBuf, boundary: noExtBoundary } = buildFormData({
    file: { file: goodCV, filename: "noextension", contentType: "text/plain" },
    studentId,
  });
  const noExtRes = await makeFormDataRequest("/api/application/cv-upload", noExtBuf, noExtBoundary);
  assert(noExtRes.status === 400, "No file extension: rejected with 400");

  // Path traversal in filename
  const { buffer: traversalBuf, boundary: traversalBoundary } = buildFormData({
    file: { file: goodCV, filename: "../../../etc/passwd.txt", contentType: "text/plain" },
    studentId,
  });
  const traversalRes = await makeFormDataRequest("/api/application/cv-upload", traversalBuf, traversalBoundary);
  assert(traversalRes.status === 200, "Path traversal filename: upload succeeds (sanitized)");
  assert(!traversalRes.data?.savedFilename?.includes(".."), "Path traversal: filename sanitized");

  // Check if savedPath is leaked in response
  warn(!traversalRes.data?.savedPath, "savedPath not leaked in response (information disclosure)");

  // ============================================================
  console.log("\n--- 4. CV APPLY: DATA MERGE ---");
  // ============================================================

  // Apply with no existing profile
  const applyRes1 = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    studentId,
    parsedCV: goodParsed,
    overwrite: false,
  }));
  assert(applyRes1.status === 200, "CV apply: succeeds on empty profile");
  assert(applyRes1.data?.appliedFields?.education === 1, "CV apply: education count correct");

  // Verify profile was updated
  const profileRes1 = await makeRequest(`/api/application/profile?studentId=${studentId}`);
  assert(profileRes1.data?.profile?.personalData?.firstName === "Shivang", "CV apply: name persisted");
  assert(profileRes1.data?.profile?.education?.length === 1, "CV apply: education persisted");

  // Apply again with different data (should merge, not overwrite)
  const newParsed = {
    ...goodParsed,
    personalData: { ...goodParsed.personalData, firstName: "Changed" },
    education: [...goodParsed.education, {
      id: "new-edu-1", institution: "New University", degree: "M.Tech",
      specialization: "AI", startYear: "2024", endYear: "2026", cgpa: "9.0", cgpaScale: "10",
    }],
  };
  const applyRes2 = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    studentId,
    parsedCV: newParsed,
    overwrite: false,
  }));
  assert(applyRes2.status === 200, "CV apply: second apply succeeds");

  // Verify merge: name should NOT be overwritten (overwrite=false)
  const profileRes2 = await makeRequest(`/api/application/profile?studentId=${studentId}`);
  assert(profileRes2.data?.profile?.personalData?.firstName === "Shivang", "CV apply: name NOT overwritten (merge mode)");
  assert(profileRes2.data?.profile?.education?.length === 2, `CV apply: education merged (${profileRes2.data?.profile?.education?.length} records)`);

  // Apply with overwrite=true
  const applyRes3 = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    studentId,
    parsedCV: newParsed,
    overwrite: true,
  }));
  assert(applyRes3.status === 200, "CV apply: overwrite mode succeeds");
  const profileRes3 = await makeRequest(`/api/application/profile?studentId=${studentId}`);
  assert(profileRes3.data?.profile?.personalData?.firstName === "Changed", "CV apply: name overwritten (overwrite mode)");

  // ============================================================
  console.log("\n--- 5. CV APPLY: VALIDATION ---");
  // ============================================================

  // No studentId
  const noIdApply = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    parsedCV: goodParsed,
  }));
  assert(noIdApply.status === 400, "CV apply: no studentId rejected");

  // No parsedCV
  const noCvApply = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    studentId,
  }));
  assert(noCvApply.status === 400, "CV apply: no parsedCV rejected");

  // Invalid studentId
  const badIdApply = await makeRequest("/api/application/cv-apply", "POST", JSON.stringify({
    studentId: "nonexistent",
    parsedCV: goodParsed,
  }));
  assert(badIdApply.status === 404, "CV apply: invalid studentId rejected with 404");

  // ============================================================
  console.log("\n--- 6. FILE STORAGE ---");
  // ============================================================

  // Verify file was saved on server
  const fileCheck = await new Promise((resolve) => {
    const req = http.request(`${BASE}/uploads/students/${studentId}/`, (res) => {
      resolve({ status: res.statusCode });
    });
    req.on("error", () => resolve({ status: 0 }));
    req.end();
  });
  // uploads/ directory should NOT be web-accessible (Next.js doesn't serve it)
  assert(fileCheck.status === 404, "Uploads directory not web-accessible (404)");

  // ============================================================
  console.log("\n--- 7. PARSER FALSE POSITIVES ---");
  // ============================================================

  // CV with "intern" in "internal" — should not match as internship
  const falsePositiveCV = `John Doe
New York, USA
john@example.com | +1-555-123-4567

EXPERIENCE
Software Engineer at Tech Corp
Jan 2021 - Present
- Maintained internal tools and infrastructure
- Led team of 5 developers

SKILLS
Programming: Python, JavaScript
`;
  const { buffer: fpBuf, boundary: fpBoundary } = buildFormData({
    file: { file: falsePositiveCV, filename: "falsepos.txt", contentType: "text/plain" },
    studentId,
  });
  const fpRes = await makeFormDataRequest("/api/application/cv-upload", fpBuf, fpBoundary);
  assert(fpRes.status === 200, "False positive test: upload succeeds");
  const fpParsed = fpRes.data?.parsed;
  // "internal" contains "intern" — check if it created a false internship type
  const falseInternships = fpParsed?.experience?.filter(e => e.type === "Internship") || [];
  warn(falseInternships.length === 0, `False positive: 'internal' not matched as internship (got ${falseInternships.length} false internships)`);

  // "C" matching as programming language in arbitrary text
  const cFalsePosCV = `Jane Smith
London, UK
jane@example.com

EDUCATION
Bachelor in Biology, Oxford University
2018 - 2021

SKILLS
Laboratory techniques, C. elegans research
`;
  const { buffer: cBuf, boundary: cBoundary } = buildFormData({
    file: { file: cFalsePosCV, filename: "cfalse.txt", contentType: "text/plain" },
    studentId,
  });
  const cRes = await makeFormDataRequest("/api/application/cv-upload", cBuf, cBoundary);
  const cParsed = cRes.data?.parsed;
  warn(!cParsed?.skills?.programming?.includes("C"), `False positive: 'C' not matched from 'C. elegans' (got: ${cParsed?.skills?.programming?.join(", ")})`);

  // ============================================================
  console.log("\n--- 8. LARGE FILE HANDLING ---");
  // ============================================================

  // File just under 10MB
  const largeContent = "A".repeat(9 * 1024 * 1024); // 9MB
  const { buffer: largeBuf, boundary: largeBoundary } = buildFormData({
    file: { file: largeContent, filename: "large.txt", contentType: "text/plain" },
    studentId,
  });
  const largeRes = await makeFormDataRequest("/api/application/cv-upload", largeBuf, largeBoundary);
  // Should either succeed (200) or fail gracefully (500 with error)
  assert(largeRes.status === 200 || largeRes.status === 500, `Large file (9MB): handled gracefully (status ${largeRes.status})`);

  // ============================================================
  console.log("\n--- 9. CONCURRENT UPLOADS ---");
  // ============================================================

  // Two simultaneous applies — check for race condition
  const concurrentParsed1 = { ...goodParsed, personalData: { ...goodParsed.personalData, firstName: "Concurrent1" } };
  const concurrentParsed2 = { ...goodParsed, personalData: { ...goodParsed.personalData, firstName: "Concurrent2" } };

  const [concurrent1, concurrent2] = await Promise.all([
    makeRequest("/api/application/cv-apply", "POST", JSON.stringify({ studentId, parsedCV: concurrentParsed1, overwrite: true })),
    makeRequest("/api/application/cv-apply", "POST", JSON.stringify({ studentId, parsedCV: concurrentParsed2, overwrite: true })),
  ]);
  assert(concurrent1.status === 200 && concurrent2.status === 200, "Concurrent applies: both succeed");
  // One should win — check final state
  const finalProfile = await makeRequest(`/api/application/profile?studentId=${studentId}`);
  const finalName = finalProfile.data?.profile?.personalData?.firstName;
  assert(finalName === "Concurrent1" || finalName === "Concurrent2", `Concurrent applies: final state consistent (${finalName})`);
  warn(false, "Concurrent applies: last-write-wins (potential race condition — see report)");

  // ============================================================
  console.log("\n--- 10. CLEANUP ---");
  // ============================================================

  // Delete test student
  await new Promise((resolve) => {
    const req = http.request(`${BASE}/api/application/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      res.on("data", () => {});
      res.on("end", resolve);
    });
    req.write(JSON.stringify({ studentId, profileData: {} }));
    req.end();
  });

  console.log(`  Test student ID: ${studentId}`);

  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${warnings} warnings`);
  console.log("=".repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
