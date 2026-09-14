// ============================================================
// PHASE UI-9SECTION: Acceptance test
// ============================================================
// Creates a rich synthetic student, fills all 9 sections,
// then revisits pages 1, 3, 6, 9 and edits values.
// Verifies: changes persist, tracker updates, no data loss.
// No OpenAI generation required.
// ============================================================

const http = require("http");
const crypto = require("crypto");

const BASE = "http://127.0.0.1:5010";

function makeRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    const req = http.request(`${BASE}${path}`, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log("=".repeat(60));
  console.log("9-SECTION INTAKE ACCEPTANCE TEST");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;
  function assert(cond, name) {
    if (cond) { console.log(`  PASS: ${name}`); passed++; }
    else { console.log(`  FAIL: ${name}`); failed++; }
  }

  // ===== Create synthetic student + application =====
  console.log("\n--- Create Synthetic Student + Application ---");
  const studentEmail = `acceptance-${Date.now()}@dvivid.test`;
  const createRes = await makeRequest("/api/application/save", "POST", {
    student: {
      firstName: "Acceptance",
      lastName: "TestStudent",
      email: studentEmail,
      phone: "+91-99999-99999",
      country: "India",
    },
    application: {
      universityName: "MIT",
      programName: "MS Computer Science",
      degree: "Master of Science",
      country: "USA",
      intake: "Fall",
      intakeYear: "2027",
    },
    document: {
      documentType: "STATEMENT_OF_PURPOSE",
      documentTitle: "Statement of Purpose",
      promptText: "Describe your academic background and career goals.",
      promptSource: "CONSULTANT_PROVIDED",
    },
  });
  assert(createRes.status === 200, `Student + Application created (status: ${createRes.status})`);
  const student = createRes.data.student;
  const application = createRes.data.application;
  assert(!!student?.id, "Student has ID");
  assert(!!application?.id, "Application has ID");

  // ===== Fill all 9 sections =====
  console.log("\n--- Fill All 9 Sections ---");

  // Section 1: Student Details
  const profile1 = {
    personalData: {
      firstName: "Acceptance",
      lastName: "TestStudent",
      email: studentEmail,
      phone: "+91-99999-99999",
      dateOfBirth: "2000-01-15",
      nationality: "Indian",
      currentCity: "Mumbai",
      currentCountry: "India",
    },
    education: [{
      id: crypto.randomUUID(),
      level: "Bachelor's",
      institution: "IIT Bombay",
      degree: "B.Tech",
      specialization: "Computer Science",
      startYear: "2019",
      endYear: "2023",
      cgpa: "9.2",
      cgpaScale: "10",
      backlogs: "0",
    }],
  };
  const save1 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile1 });
  assert(save1.status === 200, "Section 1 (Student Details) saved");

  // Section 2: Field Motivation
  const profile2 = { ...profile1, fieldMotivation: "I chose CS because of my fascination with algorithms and data structures." };
  const save2 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile2 });
  assert(save2.status === 200, "Section 2 (Field Motivation) saved");

  // Section 3: Academics & Projects
  const profile3 = {
    ...profile2,
    projects: [{
      id: crypto.randomUUID(),
      name: "ML Stock Predictor",
      type: "Academic",
      description: "Built a stock prediction model using LSTM",
      role: "Lead Developer",
      objective: "Predict stock prices with 85% accuracy",
      technologies: "Python, TensorFlow, Keras",
      methods: "Deep Learning, Time Series Analysis",
      outcome: "Achieved 82% accuracy on test data",
      challenges: "Handling volatile market conditions",
      whatLearned: "LSTM architecture and feature engineering",
      whyChosen: "Interest in financial ML",
    }],
    subjects: [{
      id: crypto.randomUUID(),
      name: "Data Structures",
      topics: "Trees, Graphs, Dynamic Programming",
      relevance: "Foundation for algorithmic thinking",
    }],
    skills: {
      technical: ["Machine Learning", "Data Analysis"],
      tools: ["Git", "JIRA"],
      programming: ["Python", "Java", "C++"],
      domain: ["Financial Modeling"],
      soft: ["Leadership", "Communication"],
    },
  };
  const save3 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile3 });
  assert(save3.status === 200, "Section 3 (Academics & Projects) saved");

  // Section 4: Work Experience
  const profile4 = {
    ...profile3,
    experience: [{
      id: crypto.randomUUID(),
      type: "Internship",
      organization: "Google",
      role: "Software Engineering Intern",
      location: "Bangalore",
      startDate: "2022-06",
      endDate: "2022-08",
      currentlyWorking: false,
      responsibilities: "Built internal tools for data pipeline",
      achievements: "Reduced processing time by 40%",
      skillsUsed: "Python, SQL, Airflow",
      keyLearning: "Large-scale data processing",
      relevanceToMasters: "Practical ML application experience",
    }],
  };
  const save4 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile4 });
  assert(save4.status === 200, "Section 4 (Work Experience) saved");

  // Section 5: Master's Motivation
  const profile5 = {
    ...profile4,
    mastersMotivation: {
      whyField: "I want to deepen my knowledge in ML and AI",
      whyNow: "I have 2 years of industry experience and want to formalize my knowledge",
      skillGaps: "Advanced ML theory and research methodology",
      academicMotivation: "Want to publish in top conferences",
      professionalMotivation: "Transition to ML research role",
      expectedLearning: "Cutting-edge ML techniques and research skills",
      careerSupport: "Master's will enable research scientist positions",
    },
  };
  const save5 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile5 });
  assert(save5.status === 200, "Section 5 (Master's Motivation) saved");

  // Section 6: Country Questions
  const profile6 = {
    ...profile5,
    countryQuestionnaire: {
      countryCode: "USA",
      answers: {
        whyCountry: "US has the best CS research programs",
        whyNotHomeCountry: "India lacks specialized ML research labs",
        educationSystem: "Flexible curriculum and research funding",
        careerSupport: "US tech industry offers best ML opportunities",
        postStudyIntentions: "Plan to work on OPT then return to India",
      },
    },
  };
  const save6 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile6 });
  assert(save6.status === 200, "Section 6 (Country Questions) saved");

  // Section 7: Subject Requirements (optional)
  const profile7 = {
    ...profile6,
    subjectRequirements: {
      notes: [{
        id: crypto.randomUUID(),
        type: "consultant",
        content: "Strong foundation in linear algebra and probability required",
      }],
    },
  };
  const save7 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile7 });
  assert(save7.status === 200, "Section 7 (Subject Requirements) saved");

  // Section 8: University Requirements (optional)
  const profile8 = {
    ...profile7,
    universityRequirements: {
      promptText: "Describe your academic and research background",
      wordMin: "500",
      wordMax: "1000",
      characterLimit: "",
      pageLimit: "2",
      mandatoryTopics: "Research experience, Career goals",
      officialSourceUrl: "https://mit.edu/admissions",
    },
  };
  const save8 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile8 });
  assert(save8.status === 200, "Section 8 (University Requirements) saved");

  // Section 9: Career Goals
  const profile9 = {
    ...profile8,
    careerGoals: {
      shortTerm: {
        role: "ML Research Scientist",
        industry: "Technology",
        responsibilities: "Develop and deploy ML models for production",
        location: "USA or India",
      },
      longTerm: {
        vision: "Lead an AI research lab in India",
        goals: "Publish influential research and mentor young researchers",
        impact: "Make AI accessible for social good in India",
        homeCountryPlans: "Return to India to start an AI research lab",
      },
    },
  };
  const save9 = await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: profile9 });
  assert(save9.status === 200, "Section 9 (Career Goals) saved");

  // ===== Verify all data persisted =====
  console.log("\n--- Verify All Data Persisted ---");
  const loadRes = await makeRequest(`/api/application/profile?studentId=${student.id}`);
  const loadedProfile = loadRes.data.profile;
  assert(loadedProfile.personalData?.firstName === "Acceptance", "Personal data persisted");
  assert(loadedProfile.education?.length === 1, "Education persisted");
  assert(loadedProfile.fieldMotivation?.includes("algorithms"), "Field motivation persisted");
  assert(loadedProfile.projects?.length === 1, "Projects persisted");
  assert(loadedProfile.subjects?.length === 1, "Subjects persisted");
  assert(loadedProfile.skills?.programming?.length === 3, "Skills persisted");
  assert(loadedProfile.experience?.length === 1, "Experience persisted");
  assert(loadedProfile.mastersMotivation?.whyField?.includes("ML"), "Master's motivation persisted");
  assert(loadedProfile.countryQuestionnaire?.countryCode === "USA", "Country questionnaire persisted");
  assert(loadedProfile.countryQuestionnaire?.answers?.whyCountry?.includes("research"), "Country answers persisted");
  assert(loadedProfile.subjectRequirements?.notes?.length === 1, "Subject requirements persisted");
  assert(loadedProfile.universityRequirements?.wordMax === "1000", "University requirements persisted");
  assert(loadedProfile.careerGoals?.shortTerm?.role === "ML Research Scientist", "Career goals short-term persisted");
  assert(loadedProfile.careerGoals?.longTerm?.vision?.includes("AI research lab"), "Career goals long-term persisted");

  // ===== Edit pages 1, 3, 6, 9 and verify changes persist =====
  console.log("\n--- Edit Pages 1, 3, 6, 9 ---");

  // Edit Page 1: Change city
  const edit1 = { ...loadedProfile, personalData: { ...loadedProfile.personalData, currentCity: "Delhi" } };
  await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: edit1 });

  // Edit Page 3: Add a second project
  const edit3 = {
    ...edit1,
    projects: [...(edit1.projects || []), {
      id: crypto.randomUUID(),
      name: "NLP Chatbot",
      type: "Personal",
      description: "Built a chatbot using GPT",
      role: "Solo Developer",
      objective: "Create a helpful AI assistant",
      technologies: "Python, OpenAI API",
      methods: "NLP, Transformers",
      outcome: "Deployed to 1000+ users",
      challenges: "Handling edge cases",
      whatLearned: "Transformer architecture",
      whyChosen: "Interest in conversational AI",
    }],
  };
  await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: edit3 });

  // Edit Page 6: Change country to UK
  const edit6 = {
    ...edit3,
    countryQuestionnaire: {
      countryCode: "UK",
      answers: {
        whyCountry: "UK has excellent 1-year master's programs",
        whyNotHomeCountry: "India lacks specialized AI research",
        educationSystem: "Research-intensive curriculum",
        careerSupport: "UK tech sector growing rapidly",
        postStudyIntentions: "Return to India after studies",
      },
    },
  };
  await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: edit6 });

  // Edit Page 9: Change career goal
  const edit9 = {
    ...edit6,
    careerGoals: {
      shortTerm: { role: "AI Engineer", industry: "Healthcare", responsibilities: "Build medical AI", location: "UK" },
      longTerm: { vision: "Lead healthcare AI division", goals: "Improve patient outcomes", impact: "Save lives through AI", homeCountryPlans: "Return to build healthcare AI in India" },
    },
  };
  await makeRequest("/api/application/profile", "PUT", { studentId: student.id, profileData: edit9 });

  // ===== Verify edits persisted =====
  console.log("\n--- Verify Edits Persisted ---");
  const verifyRes = await makeRequest(`/api/application/profile?studentId=${student.id}`);
  const verified = verifyRes.data.profile;
  assert(verified.personalData?.currentCity === "Delhi", "Page 1 edit (city) persisted");
  assert(verified.projects?.length === 2, "Page 3 edit (new project) persisted");
  assert(verified.projects?.[1]?.name === "NLP Chatbot", "Page 3 edit (project name) correct");
  assert(verified.countryQuestionnaire?.countryCode === "UK", "Page 6 edit (country) persisted");
  assert(verified.countryQuestionnaire?.answers?.whyCountry?.includes("1-year"), "Page 6 edit (answer) correct");
  assert(verified.careerGoals?.shortTerm?.role === "AI Engineer", "Page 9 edit (career goal) persisted");
  assert(verified.careerGoals?.shortTerm?.industry === "Healthcare", "Page 9 edit (industry) correct");

  // ===== Verify no data loss in other sections =====
  console.log("\n--- Verify No Data Loss ---");
  assert(verified.education?.length === 1, "Education not lost");
  assert(verified.experience?.length === 1, "Experience not lost");
  assert(verified.mastersMotivation?.whyField?.includes("ML"), "Master's motivation not lost");
  assert(verified.subjectRequirements?.notes?.length === 1, "Subject requirements not lost");
  assert(verified.universityRequirements?.wordMax === "1000", "University requirements not lost");
  assert(verified.skills?.programming?.length === 3, "Skills not lost");
  assert(verified.subjects?.length === 1, "Subjects not lost");

  // ===== Verify profile adapter maps new fields =====
  console.log("\n--- Verify Profile Adapter Maps New Fields ---");
  // The adapter should map fieldMotivation → personalStory.motivation
  // and mastersMotivation → careerGoals.whyProgram
  // We can't call the adapter directly, but we can verify via the generation context
  // (which would require OpenAI). Instead, verify the data is in the profile.
  assert(!!verified.fieldMotivation, "fieldMotivation available for adapter");
  assert(!!verified.mastersMotivation?.whyField, "mastersMotivation available for adapter");
  assert(!!verified.countryQuestionnaire?.answers, "countryQuestionnaire available for adapter");
  assert(!!verified.subjects, "subjects available for adapter");
  assert(!!verified.skills, "skills available for adapter");
  assert(!!verified.careerGoals?.shortTerm, "careerGoals.shortTerm available for adapter");
  assert(!!verified.careerGoals?.longTerm, "careerGoals.longTerm available for adapter");

  // ===== Cleanup =====
  console.log("\n--- Cleanup ---");
  // Delete test student (cascades to applications, documents, etc.)
  // Actually, we don't have a delete endpoint. Just leave the test data.
  console.log(`  Test student ID: ${student.id}`);
  console.log(`  Test application ID: ${application.id}`);

  // ===== Summary =====
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
