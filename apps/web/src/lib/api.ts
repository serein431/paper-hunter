import type { AnalysisResult, SampleCase } from "@paper-hunter/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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
