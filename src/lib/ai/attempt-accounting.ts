/**
 * @file attempt-accounting.ts
 * @description
 * Correct attempt accounting semantics.
 *
 * Separates:
 *   - pipelineRuns (total pipeline invocations)
 *   - contentGenerationAttempts (new content generations)
 *   - technicalStageRetries (resume from checkpoint)
 *   - successfulPipelineRuns
 *   - failedPipelineRuns
 *
 * All paid calls count toward allAttemptCost — even when the pipeline
 * ultimately fails.
 */

export interface StageRetryRecord {
  stageName: string;
  stageIndex: number;
  reason: string;
  sdkRetries: number;
  applicationRetries: number;
  costUsd: number;
  timestamp: string;
}

export interface AttemptAccounting {
  pipelineRuns: number;
  contentGenerationAttempts: number;
  technicalStageRetries: number;
  successfulPipelineRuns: number;
  failedPipelineRuns: number;
  paidApiCalls: number;
  successfulRunCostUsd: number;
  technicalRetryCostUsd: number;
  allAttemptCostUsd: number;
  allAttemptCostInr: number;
  stageRetries: StageRetryRecord[];
  unknownUsageApiCalls: number;
  billingUncertain: boolean;
  costCompleteness: "COMPLETE" | "KNOWN_USAGE_ONLY";
}

export class AttemptAccountingTracker {
  private accounting: AttemptAccounting;
  private stageRetries: StageRetryRecord[] = [];
  private exchangeRate: number;

  constructor(exchangeRate = 1) {
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("INVALID_EXCHANGE_RATE");
    this.exchangeRate = exchangeRate;
    this.accounting = {
      pipelineRuns: 0,
      contentGenerationAttempts: 0,
      technicalStageRetries: 0,
      successfulPipelineRuns: 0,
      failedPipelineRuns: 0,
      paidApiCalls: 0,
      successfulRunCostUsd: 0,
      technicalRetryCostUsd: 0,
      allAttemptCostUsd: 0,
      allAttemptCostInr: 0,
      stageRetries: [],
      unknownUsageApiCalls: 0,
      billingUncertain: false,
      costCompleteness: "COMPLETE",
    };
  }

  recordPipelineRun(): void {
    this.accounting.pipelineRuns++;
  }

  recordContentGenerationAttempt(): void {
    this.accounting.contentGenerationAttempts++;
  }

  recordTechnicalRetry(record: StageRetryRecord): void {
    this.accounting.technicalStageRetries++;
    this.stageRetries.push({ ...record });
    this.accounting.technicalRetryCostUsd += record.costUsd;
  }

  recordPaidApiCall(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("INVALID_USAGE_COST");
    this.accounting.paidApiCalls++;
    this.accounting.allAttemptCostUsd += costUsd;
    this.accounting.allAttemptCostInr += costUsd * this.exchangeRate;
  }

  recordSuccessfulRun(costUsd: number, costInr: number): void {
    this.accounting.successfulPipelineRuns++;
    this.accounting.successfulRunCostUsd = costUsd;
  }

  recordFailedRun(): void {
    this.accounting.failedPipelineRuns++;
  }

  /** Record a partial/failed attempt's cost (already paid) */
  recordPartialAttemptCost(costUsd: number, costInr: number): void {
    this.accounting.allAttemptCostUsd += costUsd;
    this.accounting.allAttemptCostInr += costInr;
  }

  recordUnknownUsageApiCall(): void {
    this.accounting.unknownUsageApiCalls++;
    this.accounting.billingUncertain = true;
    this.accounting.costCompleteness = "KNOWN_USAGE_ONLY";
  }

  getAccounting(): AttemptAccounting {
    return {
      ...this.accounting,
      stageRetries: [...this.stageRetries],
    };
  }
}
