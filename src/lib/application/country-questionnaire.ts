// ============================================================
// COUNTRY QUESTIONNAIRE CONFIG
// Phase SOP-INFRA-37 / UI-9SECTION
// ============================================================
// Server/config-driven country-specific question definitions.
// The UI reads from this config — questions are NOT hardcoded
// in UI components.
//
// To add a new country, add an entry to COUNTRY_QUESTIONNAIRES.
// ============================================================

export interface CountryQuestion {
  id: string;
  label: string;
  helper?: string;
  required: boolean;
  placeholder?: string;
}

export interface CountryQuestionnaire {
  countryCode: string;
  countryName: string;
  questions: CountryQuestion[];
}

export const COUNTRY_QUESTIONNAIRES: Record<string, CountryQuestionnaire> = {
  USA: {
    countryCode: "USA",
    countryName: "United States",
    questions: [
      {
        id: "whyCountry",
        label: "Why do you want to study in the United States?",
        helper: "What specific aspects of the US education system attract you?",
        required: true,
        placeholder: "The US education system emphasizes...",
      },
      {
        id: "whyNotHomeCountry",
        label: "Why not study the same program in your home country?",
        helper: "What gaps exist in your home country's education system for this field?",
        required: true,
        placeholder: "While my home country offers...",
      },
      {
        id: "educationSystem",
        label: "What attracts you to the US education system specifically?",
        helper: "Research facilities, practical training, curriculum flexibility, etc.",
        required: false,
        placeholder: "The US education system offers...",
      },
      {
        id: "careerSupport",
        label: "How does studying in the US support your career goals?",
        required: true,
        placeholder: "Studying in the US will...",
      },
      {
        id: "postStudyIntentions",
        label: "What are your post-study intentions?",
        helper: "OPT, return to home country, further research, etc.",
        required: true,
        placeholder: "After completing my studies...",
      },
    ],
  },
  UK: {
    countryCode: "UK",
    countryName: "United Kingdom",
    questions: [
      {
        id: "whyCountry",
        label: "Why do you want to study in the United Kingdom?",
        required: true,
        placeholder: "The UK's academic reputation...",
      },
      {
        id: "whyNotHomeCountry",
        label: "Why not study the same program in your home country?",
        required: true,
        placeholder: "While my home country offers...",
      },
      {
        id: "educationSystem",
        label: "What attracts you to the UK education system?",
        helper: "Research intensity, 1-year master's, global recognition, etc.",
        required: false,
        placeholder: "The UK education system...",
      },
      {
        id: "careerSupport",
        label: "How does studying in the UK support your career goals?",
        required: true,
        placeholder: "Studying in the UK will...",
      },
      {
        id: "postStudyIntentions",
        label: "What are your post-study intentions?",
        helper: "Graduate route visa, return home, further study, etc.",
        required: true,
        placeholder: "After completing my studies...",
      },
    ],
  },
  Canada: {
    countryCode: "Canada",
    countryName: "Canada",
    questions: [
      {
        id: "whyCountry",
        label: "Why do you want to study in Canada?",
        required: true,
        placeholder: "Canada's education system...",
      },
      {
        id: "whyNotHomeCountry",
        label: "Why not study the same program in your home country?",
        required: true,
        placeholder: "While my home country offers...",
      },
      {
        id: "educationSystem",
        label: "What attracts you to Canada's education system?",
        helper: "Co-op programs, research funding, multicultural environment, etc.",
        required: false,
        placeholder: "Canada's education system...",
      },
      {
        id: "careerSupport",
        label: "How does studying in Canada support your career goals?",
        required: true,
        placeholder: "Studying in Canada will...",
      },
      {
        id: "postStudyIntentions",
        label: "What are your post-study intentions?",
        helper: "PGWP, permanent residency, return home, etc.",
        required: true,
        placeholder: "After completing my studies...",
      },
    ],
  },
  Australia: {
    countryCode: "Australia",
    countryName: "Australia",
    questions: [
      {
        id: "whyCountry",
        label: "Why do you want to study in Australia?",
        required: true,
        placeholder: "Australia's education system...",
      },
      {
        id: "whyNotHomeCountry",
        label: "Why not study the same program in your home country?",
        required: true,
        placeholder: "While my home country offers...",
      },
      {
        id: "educationSystem",
        label: "What attracts you to Australia's education system?",
        required: false,
        placeholder: "Australia's education system...",
      },
      {
        id: "careerSupport",
        label: "How does studying in Australia support your career goals?",
        required: true,
        placeholder: "Studying in Australia will...",
      },
      {
        id: "postStudyIntentions",
        label: "What are your post-study intentions?",
        helper: "Temporary graduate visa, return home, etc.",
        required: true,
        placeholder: "After completing my studies...",
      },
    ],
  },
  Germany: {
    countryCode: "Germany",
    countryName: "Germany",
    questions: [
      {
        id: "whyCountry",
        label: "Why do you want to study in Germany?",
        required: true,
        placeholder: "Germany's education system...",
      },
      {
        id: "whyNotHomeCountry",
        label: "Why not study the same program in your home country?",
        required: true,
        placeholder: "While my home country offers...",
      },
      {
        id: "educationSystem",
        label: "What attracts you to Germany's education system?",
        helper: "Research focus, industry collaboration, low/no tuition, etc.",
        required: false,
        placeholder: "Germany's education system...",
      },
      {
        id: "careerSupport",
        label: "How does studying in Germany support your career goals?",
        required: true,
        placeholder: "Studying in Germany will...",
      },
      {
        id: "postStudyIntentions",
        label: "What are your post-study intentions?",
        helper: "Job seeker visa, return home, EU opportunities, etc.",
        required: true,
        placeholder: "After completing my studies...",
      },
    ],
  },
};

// Generic fallback for countries not explicitly configured
export const DEFAULT_QUESTIONNAIRE: CountryQuestionnaire = {
  countryCode: "OTHER",
  countryName: "Destination Country",
  questions: [
    {
      id: "whyCountry",
      label: "Why do you want to study in this country?",
      required: true,
      placeholder: "This country's education system...",
    },
    {
      id: "whyNotHomeCountry",
      label: "Why not study the same program in your home country?",
      required: true,
      placeholder: "While my home country offers...",
    },
    {
      id: "educationSystem",
      label: "What attracts you to this country's education system?",
      required: false,
      placeholder: "The education system in this country...",
    },
    {
      id: "careerSupport",
      label: "How does studying in this country support your career goals?",
      required: true,
      placeholder: "Studying in this country will...",
    },
    {
      id: "postStudyIntentions",
      label: "What are your post-study intentions?",
      required: true,
      placeholder: "After completing my studies...",
    },
  ],
};

export function getCountryQuestionnaire(countryCode: string): CountryQuestionnaire {
  return COUNTRY_QUESTIONNAIRES[countryCode] || DEFAULT_QUESTIONNAIRE;
}

export function getAvailableCountries(): { code: string; name: string }[] {
  return Object.values(COUNTRY_QUESTIONNAIRES).map(q => ({
    code: q.countryCode,
    name: q.countryName,
  }));
}
