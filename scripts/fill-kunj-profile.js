// Fill Kunj's intake profile via the API so screenshots show realistic data
const BASE = 'https://sop.adelphostech.com';
const STUDENT_ID = 'b27a7a16-ac81-4a6f-93d7-0692f3849a9c';
const APP_ID = '83f61398-7210-4710-8a52-10e183cadaaa';

async function saveProfile(profileData, expectedRevision) {
  const body = { studentId: STUDENT_ID, profileData, expectedRevision };
  const res = await fetch(`${BASE}/api/application/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Profile save failed: ${JSON.stringify(data)}`);
  console.log('Saved profile, revision:', data.revision);
  return data.revision;
}

async function main() {
  // First GET to get current revision
  const getRes = await fetch(`${BASE}/api/application/profile?studentId=${STUDENT_ID}`);
  const getData = await getRes.json();
  let rev = getData.revision || 0;
  console.log('Current revision:', rev);

  const profile = {
    personalData: {
      firstName: 'Kunj',
      lastName: 'Modh',
      email: 'kunjmodh99@gmail.com',
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
  };

  rev = await saveProfile(profile, rev);
  console.log('Profile filled successfully!');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
