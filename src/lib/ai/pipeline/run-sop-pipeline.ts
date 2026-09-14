import { StudentProfile } from "@/types";
import { PipelineResult, LanguageProfile } from "../types";
import { runApplicationPipeline, ApplicationPipelineInput, ApplicationPipelineResult } from "./run-application-pipeline";

type LegacyApplicationResult = PipelineResult & {
  generationId?: string;
  compliance?: ApplicationPipelineResult["compliance"];
};

export async function runSopPipeline(
  profile: StudentProfile,
  applicationInput?: Omit<ApplicationPipelineInput, "profile">
): Promise<LegacyApplicationResult> {
  const pipelineStart = Date.now();
  if (!applicationInput?.generationContract || !applicationInput.requirementsBrief || !applicationInput.aiPolicy) {
    return {
      status: "error", planner: null, draft: "", factReview: null,
      qualityReview: null, languageProfile: null, finalSop: "",
      metrics: { wordCount: 0, model: "", stages: 0, duration: 0, cost: null },
      error: "APPLICATION_GENERATION_INPUT_REQUIRED",
    };
  }

  try {
    // STAGE 1: PLANNER
    // STAGE 2: DRAFT WRITER
    // STAGE 3: FACT REVIEWER
    // STAGE 4: QUALITY REVIEWER
    // STAGE 5: LANGUAGE CALIBRATOR
    // STAGE 6: FINALIZER
    const result = await runApplicationPipeline({
      ...applicationInput,
      profile,
      programContextText: applicationInput.generationContract.programContext
        ? JSON.stringify(applicationInput.generationContract.programContext)
        : "",
    });

    // Validate final output
    const language = applicationInput.generationContract.languageProfile;
    const languageProfile: LanguageProfile | null = result.status === "success" ? {
      level: language.desiredProfile,
      tone: language.tone,
      personalization: language.personalization,
      technicalDetail: language.technicalDetail,
      openingStyle: language.openingStyle,
      sopLength: profile.writingPreferences?.sopWritingProfile?.sopLength || "Use University Requirement",
      actualEnglishProficiency: {
        testType: language.testType,
        overallScore: language.overallScore,
        writingScore: language.writingScore,
      },
    } : null;

    // Calculate total cost
    // Get exchange rate
    return {
      status: result.status,
      generationId: result.generationId,
      planner: result.planner,
      draft: result.writerOutput ? JSON.stringify(result.writerOutput) : "",
      factReview: result.factReview,
      qualityReview: result.qualityReview,
      languageProfile,
      finalSop: result.finalText,
      compliance: result.compliance,
      metrics: result.metrics,
      error: result.error,
    };
  } catch (error: any) {
    // Calculate partial cost
    return {
      status: "error", planner: null, draft: "", factReview: null,
      qualityReview: null, languageProfile: null, finalSop: "",
      metrics: { wordCount: 0, model: "", stages: 0, duration: Date.now() - pipelineStart, cost: null },
      error: error?.message || "PIPELINE_ERROR",
    };
  }
}
