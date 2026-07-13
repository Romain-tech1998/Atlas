/** Confidence scores for each stage of the pipeline, plus an overall score. */
export interface ScoreBreakdown {
  intentScore: number;
  entityScore: number;
  routingScore: number;
  planScore: number;
  overallScore: number;
}
