import type {
  AnalysisResult,
  KnowledgeBaseConnector,
  KnowledgeSearchResponse,
  ModelRuntimeConfig,
  SampleCase
} from "@paper-hunter/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function artifactUrl(artifactId: string): string {
  return `${API_BASE}/api/artifacts/${artifactId}`;
}

export async function fetchSamples(): Promise<SampleCase[]> {
  const data = await parseResponse<{ samples: SampleCase[] }>(await fetch(`${API_BASE}/api/samples`));
  return data.samples;
}

export async function createSampleTask(sampleId: string): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("sample_id", sampleId);
  return parseResponse<AnalysisResult>(
    await fetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      body: form
    })
  );
}

export async function uploadPdf(file: File): Promise<AnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  return parseResponse<AnalysisResult>(
    await fetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      body: form
    })
  );
}

export async function fetchModelConfig(): Promise<ModelRuntimeConfig> {
  return parseResponse<ModelRuntimeConfig>(await fetch(`${API_BASE}/api/model-config`));
}

export async function saveModelConfig(
  config: ModelRuntimeConfig & { api_key?: string }
): Promise<ModelRuntimeConfig> {
  return parseResponse<ModelRuntimeConfig>(
    await fetch(`${API_BASE}/api/model-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    })
  );
}

export async function fetchKnowledgeBases(): Promise<KnowledgeBaseConnector[]> {
  const data = await parseResponse<{ connectors: KnowledgeBaseConnector[] }>(
    await fetch(`${API_BASE}/api/knowledge-bases`)
  );
  return data.connectors;
}

export async function searchKnowledgeBases(query: string, limit = 8): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return parseResponse<KnowledgeSearchResponse>(await fetch(`${API_BASE}/api/knowledge-search?${params}`));
}
