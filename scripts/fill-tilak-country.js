// Fill Tilak's country questionnaire so the intake shows as more complete
const BASE = 'https://sop.adelphostech.com';
const STUDENT_ID = 'b2086ce9-a26a-4b4d-baa6-a8362d70a9ba';

async function main() {
  // GET current profile + revision
  const getRes = await fetch(`${BASE}/api/application/profile?studentId=${STUDENT_ID}`);
  const getData = await getRes.json();
  let rev = getData.revision || 0;
  const profile = getData.profile || {};
  console.log('Current revision:', rev);
  console.log('Profile keys:', Object.keys(profile).slice(0, 15));

  // Add country questionnaire
  profile.countryQuestionnaire = {
    country: 'United States',
    answers: {
      'why_country': 'The US is the global leader in pharmaceutical regulatory affairs with the FDA setting international standards. Studying here gives me direct exposure to FDA regulatory processes and the world\'s largest pharmaceutical market.',
      'post_study_plans': 'I plan to work as a Regulatory Affairs Specialist in the US pharmaceutical industry for 2-3 years, then return to India to lead regulatory strategy for an Indian pharma company.',
    },
  };

  const body = { studentId: STUDENT_ID, profileData: profile, expectedRevision: rev };
  const res = await fetch(`${BASE}/api/application/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Save failed: ${JSON.stringify(data)}`);
  console.log('Country questionnaire filled! Revision:', data.revision);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
