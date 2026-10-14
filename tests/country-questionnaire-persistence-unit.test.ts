/**
 * country-questionnaire-persistence-unit.test.ts — PURE UNIT REGRESSION
 *
 * Tests resolveApplicationContext country questionnaire logic
 * with mock objects — no database required.
 */

import {
  resolveApplicationContext,
  APPLICATION_CONTEXT_VERSION,
} from "../src/lib/application/application-context";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mockApp(country: string, ctxFields: Record<string, unknown> = {}) {
  return {
    applicationContextVersion: APPLICATION_CONTEXT_VERSION.APP_SCOPED,
    country,
    contextData: Object.keys(ctxFields).length
      ? { fields: ctxFields, provenance: {} }
      : null,
  };
}

function main() {
  console.log("=== Country Questionnaire Persistence Unit Tests ===\n");

  // A. Name vs code — same country
  {
    const app = mockApp("United States", {
      countryQuestionnaire: { countryCode: "USA", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("A: 'United States' app preserves USA questionnaire",
      res.profile.countryQuestionnaire?.countryCode === "USA" &&
      res.profile.countryQuestionnaire?.answers?.q1 === "a1");
  }

  // B. Name vs code — UK
  {
    const app = mockApp("United Kingdom", {
      countryQuestionnaire: { countryCode: "UK", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("B: 'United Kingdom' app preserves UK questionnaire",
      res.profile.countryQuestionnaire?.countryCode === "UK");
  }

  // C. Direct code match
  {
    const app = mockApp("Germany", {
      countryQuestionnaire: { countryCode: "Germany", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("C: 'Germany' app preserves Germany questionnaire (name match)",
      res.profile.countryQuestionnaire?.countryCode === "Germany");
  }

  // D. Mismatch — real different countries
  {
    const app = mockApp("Germany", {
      countryQuestionnaire: { countryCode: "USA", answers: { q1: "wrong" } },
    });
    const res = resolveApplicationContext(app, {});
    check("D: USA questionnaire discarded for Germany app",
      res.profile.countryQuestionnaire === undefined,
      JSON.stringify(res.profile.countryQuestionnaire));
  }

  // E. Unknown country — lenient preservation
  {
    const app = mockApp("India", {
      countryQuestionnaire: { countryCode: "OTHER", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("E: unknown country 'India' preserves questionnaire (lenient)",
      res.profile.countryQuestionnaire?.countryCode === "OTHER");
  }

  // F. Unknown stored code — lenient preservation
  {
    const app = mockApp("United States", {
      countryQuestionnaire: { countryCode: "XYZ", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("F: unknown stored code 'XYZ' preserved for USA app (lenient)",
      res.profile.countryQuestionnaire?.countryCode === "XYZ");
  }

  // G. Both unknown — lenient preservation
  {
    const app = mockApp("France", {
      countryQuestionnaire: { countryCode: "FR", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("G: both unknown ('France' vs 'FR') preserved",
      res.profile.countryQuestionnaire?.countryCode === "FR");
  }

  // H. No questionnaire — no crash
  {
    const app = mockApp("United States", {});
    const res = resolveApplicationContext(app, {});
    check("H: missing questionnaire returns undefined",
      res.profile.countryQuestionnaire === undefined);
  }

  // I. Empty country string — no crash
  {
    const app = mockApp("", {
      countryQuestionnaire: { countryCode: "USA", answers: { q1: "a1" } },
    });
    const res = resolveApplicationContext(app, {});
    check("I: empty country string preserves questionnaire",
      res.profile.countryQuestionnaire?.countryCode === "USA");
  }

  // J. Legacy v1 app — bypasses the check entirely
  {
    const app = {
      applicationContextVersion: APPLICATION_CONTEXT_VERSION.LEGACY,
      country: "Germany",
      contextData: null,
    };
    const studentProfile = {
      countryQuestionnaire: { countryCode: "USA", answers: { q1: "legacy" } },
    };
    const res = resolveApplicationContext(app, studentProfile);
    check("J: legacy v1 app returns shared profile unchanged",
      res.profile.countryQuestionnaire?.countryCode === "USA");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 2);
}

main();
