// Create a fresh demo applicant with complete intake data for the manual screenshots
const BASE = 'https://sop.adelphostech.com';

async function main() {
  // Step 1: Create student
  console.log('1. Creating student...');
  const studentRes = await fetch(`${BASE}/api/application/student`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Kunj',
      lastName: 'Modh',
      email: 'kunj.demo@example.com',
      phone: '+91 98765 43210',
      country: 'India',
    }),
  });
  const studentData = await studentRes.json();
  if (!studentRes.ok) throw new Error(`Student create failed: ${JSON.stringify(studentData)}`);
  const studentId = studentData.student.id;
  console.log('   Student ID:', studentId);

  // Step 2: Create application
  console.log('2. Creating application...');
  const appRes = await fetch(`${BASE}/api/application/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId,
      universityName: 'Aalen University',
      programName: 'Master of Science in Machine Learning and Data Analytics',
      degree: 'Master of Science',
      department: 'Computer Science',
      country: 'Germany',
      intake: 'Summer',
      intakeYear: '2027',
    }),
  });
  const appData = await appRes.json();
  if (!appRes.ok) throw new Error(`App create failed: ${JSON.stringify(appData)}`);
  const applicationId = appData.application.id;
  console.log('   Application ID:', applicationId);

  // Step 3: Fill complete intake profile
  console.log('3. Filling intake profile...');
  const profile = {
    personalData: {
      firstName: 'Kunj',
      lastName: 'Modh',
      email: 'kunj.demo@example.com',
      phone: '+91 98765 43210',
      dateOfBirth: '2000-05-15',
      nationality: 'India',
      currentCity: 'Surat',
      currentCountry: 'India',
    },
    education: [
      {
        level: 'Bachelor',
        institution: 'SVNIT Surat',
        major: 'Computer Engineering',
        cgpa: '8.7',
        cgpaScale: '10',
        startYear: '2019',
        graduationYear: '2023',
        backlogs: '0',
      },
    ],
    projects: [
      {
        name: 'ML-Based Crop Disease Detection',
        type: 'Academic Project',
        role: 'Lead Developer',
        technologies: 'Python, TensorFlow, OpenCV, Flask',
        objective: 'Build a CNN model to detect crop diseases from leaf images',
        description: 'Developed a deep learning pipeline using transfer learning on ResNet50 to classify 38 crop diseases. Achieved 94% accuracy on test set.',
        outcome: '94% accuracy, deployed as web app for farmers',
        challenges: 'Limited labeled data; solved with data augmentation',
        learned: 'Transfer learning, CNN architecture, model deployment',
      },
    ],
    subjects: [
      {
        name: 'Machine Learning',
        topics: 'Supervised Learning, Neural Networks, Deep Learning',
        relevance: 'Core foundation for MS in ML',
      },
      {
        name: 'Data Structures & Algorithms',
        topics: 'Trees, Graphs, Dynamic Programming',
        relevance: 'Strong analytical foundation',
      },
    ],
    skills: {
      technical: ['Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision'],
      tools: ['TensorFlow', 'PyTorch', 'Scikit-learn', 'Pandas'],
      programming: ['Python', 'Java', 'C++', 'SQL'],
      domain: ['AI/ML', 'Data Analytics'],
      soft: ['Leadership', 'Team Management', 'Communication'],
    },
    experience: [
      {
        type: 'Full-time',
        organization: 'TCS',
        role: 'Software Engineer',
        location: 'Pune, India',
        startMonth: '2023-07',
        endMonth: '',
        currentlyWorking: true,
        responsibilities: 'Building ML pipelines for client projects, data preprocessing, model training',
        achievements: 'Reduced inference time by 40% through model optimization',
        skillsUsed: 'Python, TensorFlow, AWS, Docker',
        keyLearning: 'Production ML deployment, MLOps best practices',
        relevanceToMasters: 'Directly applies ML concepts I want to deepen in master\'s',
      },
    ],
    mastersMotivation: {
      whyField: 'I want to deepen my expertise in Machine Learning and Data Analytics to solve real-world problems at scale. My work at TCS showed me the gap between academic ML and production systems, and I want to bridge that gap.',
      whyNow: 'After 2 years of industry experience, I have the practical context to fully benefit from advanced coursework in ML systems and analytics.',
      skillGaps: 'Advanced statistical learning, distributed ML systems, research methodology',
      academicMotivation: 'Want to work with leading researchers on real ML applications',
      professionalMotivation: 'Goal is to become an ML Architect leading AI strategy',
      expectedLearning: 'Advanced ML algorithms, MLOps at scale, research methodology',
      careerSupport: 'Access to German tech industry and research labs',
    },
    countryQuestionnaire: {
      countryCode: 'DE',
      country: 'Germany',
      answers: {
        'why_germany': 'Germany is a global leader in engineering education and Industry 4.0. The combination of theoretical rigor and applied research at universities like Aalen is ideal for my goals.',
        'post_study_plans': 'I plan to work as an ML Engineer in Germany for 2-3 years, gaining European industry experience before returning to India to lead AI initiatives.',
      },
    },
    careerGoals: {
      shortTerm: {
        role: 'Machine Learning Engineer',
        industry: 'AI/Technology',
        responsibilities: 'Design and deploy ML systems at scale',
        location: 'Germany',
      },
      longTerm: {
        vision: 'Become an AI/ML Architect leading technology strategy for a global tech company',
        goals: 'Lead a team of ML engineers, publish research, mentor young talent',
        impact: 'Make AI accessible for small and medium businesses',
        homeCountryPlans: 'Return to India after 3-5 years to build an AI startup',
      },
    },
    fieldMotivation: 'My fascination with AI started during my undergraduate AI course. Building a crop disease detection model showed me how ML can solve real problems for real people. I want to dedicate my career to making AI systems more reliable and accessible.',
  };

  // Get current revision first
  const getRes = await fetch(`${BASE}/api/application/profile?studentId=${studentId}`);
  const getData = await getRes.json();
  const rev = getData.revision || 0;

  const profileRes = await fetch(`${BASE}/api/application/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, profileData: profile, expectedRevision: rev }),
  });
  const profileData = await profileRes.json();
  if (!profileRes.ok) throw new Error(`Profile save failed: ${JSON.stringify(profileData)}`);
  console.log('   Profile saved, revision:', profileData.revision);

  // Step 4: Create SOP document
  console.log('4. Creating SOP document...');
  const docRes = await fetch(`${BASE}/api/application/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      applicationId,
      documentType: 'STATEMENT_OF_PURPOSE',
      documentTitle: 'Statement of Purpose',
      promptText: 'Write a Statement of Purpose for graduate admission to the MS in Machine Learning and Data Analytics program at Aalen University. Describe your academic background, professional experience, motivation for pursuing this program, and career goals.',
      promptSource: 'CONSULTANT_PROVIDED',
      wordMin: 800,
      wordMax: 1000,
      specialInstructions: 'Focus on ML experience and German university fit. Keep it concise.',
    }),
  });
  const docData = await docRes.json();
  if (!docRes.ok) throw new Error(`Document create failed: ${JSON.stringify(docData)}`);
  const documentId = docData.document.id;
  console.log('   Document ID:', documentId);

  // Output IDs for the screenshot script
  console.log('\n=== IDS FOR SCREENSHOTS ===');
  console.log(`STUDENT_ID=${studentId}`);
  console.log(`APP_ID=${applicationId}`);
  console.log(`DOC_ID=${documentId}`);
  console.log('==========================');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
