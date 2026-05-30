export type Severity = "low" | "medium" | "high" | "critical";
export type ReviewStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "needs_original_data"
  | "escalated"
  | "resolved";

export type AnalysisTask = {
  task_id: string;
  source_label: string;
  file_name: string;
  status: "queued" | "running" | "completed" | "failed";
  current_step: string;
  risk_score: number;
  evidence_count: number;
  image_count: number;
  reference_count: number;
  error?: string | null;
};

export type ExtractedImage = {
  image_id: string;
  task_id: string;
  page: number;
  index: number;
  width: number;
  height: number;
  checksum: string;
  artifact_id: string;
  path: string;
  extraction_method: string;
};

export type ReferenceCheck = {
  reference_id: string;
  task_id: string;
  raw_doi: string;
  normalized_doi: string;
  status: "unchecked" | "found" | "not_found" | "network_error" | "demo_fallback";
  title?: string | null;
  source: string;
};

export type EvidenceCard = {
  evidence_id: string;
  task_id: string;
  type:
    | "figure_similarity"
    | "image_clone"
    | "western_blot_anomaly"
    | "citation_not_found"
    | "citation_mismatch"
    | "citation_not_supporting_claim"
    | "retracted_reference"
    | "data_anomaly"
    | "paper_mill_signal"
    | "hidden_prompt"
    | "metadata_anomaly";
  severity: Severity;
  confidence: number;
  title: string;
  claim: string;
  method: string;
  location: string;
  recommended_action: string;
  visual_assets: Record<string, string>;
  review_status: ReviewStatus;
  reviewer_note: string;
  algorithm_version: string;
};

export type AnalysisResult = {
  task: AnalysisTask;
  images: ExtractedImage[];
  references: ReferenceCheck[];
  evidence: EvidenceCard[];
  report_markdown: string;
};

export type SampleCase = {
  id: string;
  name: string;
  description: string;
  source_type: string;
};
