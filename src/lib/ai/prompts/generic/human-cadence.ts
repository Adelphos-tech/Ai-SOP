// ============================================================
// Human writing cadence rules — shared by the Writer and the
// Language Calibrator so both stages push toward the same natural
// rhythm. STYLE ONLY: these rules never override facts, claim
// preservation, required content, or word/character limits.
// ============================================================

export const NARRATIVE_QUALITY_RULES = `NARRATIVE QUALITY RULES:
- Do NOT write skill-list or technology-enumeration paragraphs. Weave at most 3 named tools/technologies into any single paragraph, and only where they serve the story.
- Select AT MOST 3 experiences as the narrative spine; other experiences get at most one supporting sentence or are omitted.
- Every experience paragraph must contain at least one sentence of genuine reflection (what changed in the student's thinking or direction), not a formulaic closing phrase.
- Order experiences THEMATICALLY to support the arc (curiosity -> experimentation -> realization -> production experience -> knowledge gap -> why this program), not chronologically.
- Avoid repeating the same concept words more than twice across the essay (e.g., scalability, deployment, reliability, production, end-to-end).
- These rules never override required topics, required facts, or word limits: if a rule conflicts with a requirement, the requirement wins.`;

export const HUMAN_CADENCE_RULES = `HUMAN WRITING CADENCE RULES (style only — never override facts, claims, required content, or word limits):
- Vary sentence length: mix short, direct sentences with longer, more complex ones. Never write three sentences in a row of similar length and structure.
- Vary sentence openings: do NOT start consecutive sentences with the same subject or subject-verb pattern (e.g., "I structured... I developed... I implemented..."). Open some sentences with the context, the project, a time phrase, or the result instead.
- Break rigid paragraph templates: do NOT end every paragraph with a formulaic summary sentence (e.g., "This experience reinforced my desire for graduate study."). Vary how paragraphs open, transition, and close.
- Never use these stock words and connectors: "Moreover", "Furthermore", "Additionally", "In conclusion", "delve", "testament", "tapestry", "pivotal", "foster", "honed my skills", "stemmed from". Avoid formulaic three-item lists of abstract praise (e.g., "innovation, collaboration, and excellence").
- Prefer concrete specifics over abstract filler: ground each point in the student's actual projects, metrics, tools, and coursework already provided in the input. Never invent a detail to sound specific.`;

export const PLAIN_TEXT_RULE = `PLAIN-TEXT FORMATTING:
- Write plain, natural admissions prose with ZERO Markdown or LaTeX syntax. Write numbers as plain text: 7.89/10, never $7.89/10$; 30%, never $30\\%$.
- No **bold**, no *italics*, no # headers, no backslash escapes inside the text.`;
