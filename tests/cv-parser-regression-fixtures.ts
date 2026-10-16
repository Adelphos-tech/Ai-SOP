/**
 * Deterministic regression fixtures for cv-parser.ts
 * No external dependencies, no AI calls, no file I/O.
 */
export const FIXTURES = {
  // Fixture 1: Multi-line Indian secondary-school format
  multiLineIndian: {
    text: `
Akshansh Patel
Contact No. (+91) 9909907503- akshanshpatel18@gmail.com
EDUCATION
Gujarat Secondary and Higher Secondary Education Board.                                     JUN 2024- FEB-MAR 2025
Nirman High School
12th Standard
Percentage-77.2%
Gujarat Secondary and Higher Secondary Education Board\t                                     JUN 2022 -MAR 2023
Nirman High School
10th Standard
Percentage- 70.83%
SUBJECTS KNOWN
ACCOUNTANCY
Accounting for partnership reconstitution and dissolution
`.trim(),
    expected: {
      educationCount: 2,
      has12th: true,
      has10th: true,
      twelfthInstitution: "Nirman High School",
      tenthInstitution: "Nirman High School",
      experienceCount: 0,
      projectCount: 0,
    },
  },

  // Fixture 2: Flattened text from unstructured extraction (email/phone in same line as name)
  flattenedName: {
    text: `
John Doe john.doe@example.com +91 98765 43210
EDUCATION
B.Tech in Computer Science, IIT Bombay, 2019-2023
CGPA: 8.5
`.trim(),
    expected: {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      educationCount: 1,
      institution: "IIT Bombay",
    },
  },

  // Fixture 3: Experience with date but no explicit "at Company" pattern
  experienceDateOnly: {
    text: `
Jane Smith
jane@example.com
EXPERIENCE
AI Research Intern
IIT Delhi Research Lab, Bangalore
2023-2024
Description: Built an AI assistant for automated SOP generation.
Software Engineer
Google, Hyderabad
2021-2023
Led a team of 5 engineers.
`.trim(),
    expected: {
      experienceCount: 2,
      hasInternship: true,
      hasSoftwareEngineer: true,
      internOrgContainsLab: true,
    },
  },

  // Fixture 4: Description lines that should NOT be treated as role-org headers
  experienceDescriptionContamination: {
    text: `
EXPERIENCE
Data Analyst at Acme Corp, 2022-2024
Description: Built dashboards using Python and Tableau.
Managed ETL pipelines for 3 departments.
Product Manager at Beta Inc, 2020-2022
Description: Led product roadmap for mobile app.
`.trim(),
    expected: {
      experienceCount: 2,
      firstRole: "Data Analyst",
      firstOrg: "Acme Corp",
      secondRole: "Product Manager",
      secondOrg: "Beta Inc",
    },
  },

  // Fixture 5: Table-like education with flexible columns
  educationTable: {
    text: `
EDUCATION
Qualification | Institution | Year | Result
B.Tech CSE | IIT Bombay | 2019-2023 | 8.5/10
M.Tech DS | IIT Delhi | 2023-2025 | 9.0/10
`.trim(),
    expected: {
      educationCount: 2,
      firstDegree: "B.Tech CSE",
      firstInstitution: "IIT Bombay",
      secondDegree: "M.Tech DS",
    },
  },

  // Fixture 6: Generic "School" in skills should NOT create education record
  schoolInSkills: {
    text: `
EDUCATION
B.Tech in Mechanical Engineering, VIT Vellore, 2018-2022
SKILLS
Business School case study analysis
Knowledge of business management: planning, organising, staffing, directing and controlling
School-level mathematics
Python, MATLAB, AutoCAD
`.trim(),
    expected: {
      educationCount: 1,
      degree: "B.Tech",
      institution: "VIT Vellore",
    },
  },

  // Fixture 7: Projects that should NOT be classified as employment
  projectsNotEmployment: {
    text: `
PROJECTS
AI Chatbot for Healthcare - Developed an NLP-based symptom checker using Python and TensorFlow.
E-commerce Dashboard - Built a React analytics dashboard for sales metrics.
EXPERIENCE
Intern at TechCorp, 2023-2024
Developed REST APIs.
`.trim(),
    expected: {
      projectCount: 2,
      experienceCount: 1,
      firstProjectName: "AI Chatbot for Healthcare",
      firstProjectDescContains: "NLP-based symptom checker",
    },
  },

  // Fixture 8: Multiple degrees on one line (should split correctly)
  multipleDegreesOneLine: {
    text: `
EDUCATION
B.Tech in CSE, IIT Bombay, 2020 M.Tech in DS, IIT Bombay, 2022
`.trim(),
    expected: {
      educationCount: 2,
      firstDegree: "B.Tech",
      secondDegree: "M.Tech",
    },
  },

  // Fixture 9: CGPA/date fragments should not become institution
  cgpaDateFragment: {
    text: `
EDUCATION
B.Tech in ECE, NIT Trichy, 2018-2022
CGPA: 7.8
Mumbai, India
`.trim(),
    expected: {
      educationCount: 1,
      institution: "NIT Trichy",
      cgpa: "7.8",
    },
  },

  // Fixture 10: Board-only lines without school should still capture degree
  boardWithoutSchool: {
    text: `
EDUCATION
Senior Secondary, CBSE Board, 2018, 85%
12th Standard
Science Stream
`.trim(),
    expected: {
      educationCount: 1,
      degree: "12th",
    },
  },
};
