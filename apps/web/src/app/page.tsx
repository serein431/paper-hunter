"use client";

import type { AnalysisResult, EvidenceCard, SampleCase } from "@paper-hunter/types";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  FileSearch,
  FileText,
  FlaskConical,
  ImageIcon,
  Printer,
  ShieldCheck,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { artifactUrl, createSampleTask, fetchSamples, uploadPdf } from "@/lib/api";

type TabId = "dashboard" | "evidence" | "images" | "citations" | "report";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "dashboard", label: "风险仪表盘" },
  { id: "evidence", label: "证据中心" },
  { id: "images", label: "图像复核" },
  { id: "citations", label: "引用核验" },
  { id: "report", label: "报告导出" }
];

const severityLabel: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical"
};

export default function Home() {
  const [samples, setSamples] = useState<SampleCase[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetchSamples()
      .then(setSamples)
      .catch(() => {
        setSamples([
          {
            id: "synthetic-paper",
            name: "Synthetic integrity review sample",
            description: "Generated PDF with controlled duplicate-image, DOI, and hidden prompt signals.",
            source_type: "generated"
          }
        ]);
      });
  }, []);

  const filteredEvidence = useMemo(() => {
    if (!result) return [];
    return filter === "all" ? result.evidence : result.evidence.filter((card) => card.type === filter);
  }, [filter, result]);

  async function runSample(sampleId: string) {
    setLoading(true);
    setError(null);
    try {
      const nextResult = await createSampleTask(sampleId);
      setResult(nextResult);
      setActiveTab("dashboard");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Sample analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const nextResult = await uploadPdf(file);
      setResult(nextResult);
      setActiveTab("dashboard");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">Research Integrity Workbench</p>
          <h1>论文打假人 Paper Hunter</h1>
          <p className="lede">别人用 AI 发论文，我们用 AI 打假论文。</p>
        </div>
        <div className="boundary-note">
          <ShieldCheck size={18} />
          <span>输出为疑似证据，不构成最终学术不端结论。</span>
        </div>
      </section>

      <section className="launch-strip">
        <label className="upload-zone">
          <Upload size={24} />
          <span>上传 PDF 并分析</span>
          <small>单文件 MVP，支持论文 PDF</small>
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="sample-row">
          {samples.map((sample) => (
            <button
              className="sample-button"
              key={sample.id}
              onClick={() => void runSample(sample.id)}
              type="button"
            >
              <FlaskConical size={18} />
              <span>{sample.name}</span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </section>

      {loading && (
        <div className="status-banner">
          <FileSearch size={18} />
          <span>正在解析 PDF、提取图片、生成证据卡...</span>
        </div>
      )}
      {error && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {result ? (
        <section className="workbench">
          <aside className="summary-rail">
            <p className="rail-kicker">Task</p>
            <h2>{result.task.source_label}</h2>
            <dl>
              <Metric label="风险分" value={String(result.task.risk_score)} tone="risk" />
              <Metric label="证据卡" value={String(result.task.evidence_count)} />
              <Metric label="图片候选" value={String(result.task.image_count)} />
              <Metric label="DOI 信号" value={String(result.task.reference_count)} />
            </dl>
            <div className="method-stack">
              <span>PyMuPDF</span>
              <span>pHash</span>
              <span>Pixel diff</span>
              <span>Prompt scan</span>
            </div>
          </aside>

          <div className="work-area">
            <nav className="tabs" aria-label="Result views">
              {tabs.map((tab) => (
                <button
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {activeTab === "dashboard" && <Dashboard result={result} />}
            {activeTab === "evidence" && (
              <EvidenceCenter
                evidence={filteredEvidence}
                filter={filter}
                onFilterChange={setFilter}
                allEvidence={result.evidence}
              />
            )}
            {activeTab === "images" && <ImageReview evidence={result.evidence} />}
            {activeTab === "citations" && <CitationChecks result={result} />}
            {activeTab === "report" && <ReportView markdown={result.report_markdown} />}
          </div>
        </section>
      ) : (
        <section className="empty-state">
          <FileSearch size={36} />
          <div>
            <h2>先跑一个样例，立刻看到完整闭环。</h2>
            <p>上传真实 PDF 会走同一套 pipeline；公开仓库不内置真实论文全文。</p>
          </div>
        </section>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "risk" }) {
  return (
    <div className={tone === "risk" ? "metric risk" : "metric"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Dashboard({ result }: { result: AnalysisResult }) {
  const high = result.evidence.filter((card) => card.severity === "high" || card.severity === "critical");
  const figure = result.evidence.filter((card) => card.type === "figure_similarity");
  const hidden = result.evidence.filter((card) => card.type === "hidden_prompt");

  return (
    <div className="dashboard-grid">
      <Panel title="总体风险" icon={<AlertTriangle size={18} />}>
        <div className="risk-number">{result.task.risk_score}</div>
        <p>基于证据等级和数量的演示风险分，仅用于复核优先级排序。</p>
      </Panel>
      <Panel title="高风险证据" icon={<BadgeCheck size={18} />}>
        <div className="big-count">{high.length}</div>
        <p>建议优先人工查看图像对比和原始实验记录。</p>
      </Panel>
      <Panel title="图片异常" icon={<ImageIcon size={18} />}>
        <div className="big-count">{figure.length}</div>
        <p>系统比较 PDF 内嵌图片候选，不承诺任意子图自动分割。</p>
      </Panel>
      <Panel title="AI 审稿风险" icon={<ShieldCheck size={18} />}>
        <div className="big-count">{hidden.length}</div>
        <p>检测隐藏文本层中的 AI 审稿指令模式。</p>
      </Panel>
    </div>
  );
}

function EvidenceCenter({
  evidence,
  allEvidence,
  filter,
  onFilterChange
}: {
  evidence: EvidenceCard[];
  allEvidence: EvidenceCard[];
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const types = Array.from(new Set(allEvidence.map((card) => card.type)));
  return (
    <div className="stack">
      <div className="toolbar">
        <span>{evidence.length} cards</span>
        <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
          <option value="all">All evidence</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div className="evidence-list">
        {evidence.map((card) => (
          <article className="evidence-card" key={card.evidence_id}>
            <div className="card-head">
              <span className={`severity ${card.severity}`}>{severityLabel[card.severity]}</span>
              <span>{Math.round(card.confidence * 100)}%</span>
            </div>
            <h3>{card.title}</h3>
            <p>{card.claim}</p>
            <dl className="card-facts">
              <div>
                <dt>Method</dt>
                <dd>{card.method}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{card.location}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{card.review_status}</dd>
              </div>
            </dl>
            <p className="action-line">{card.recommended_action}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ImageReview({ evidence }: { evidence: EvidenceCard[] }) {
  const figureEvidence = evidence.find((card) => card.type === "figure_similarity");
  if (!figureEvidence) {
    return <EmptyPanel title="没有图片相似证据" body="当前任务未生成图片对比卡。" />;
  }
  return (
    <div className="image-review">
      <div>
        <p className="eyebrow">Figure Forensics</p>
        <h2>{figureEvidence.title}</h2>
        <p>{figureEvidence.claim}</p>
        <p className="action-line">{figureEvidence.recommended_action}</p>
      </div>
      <div className="image-grid">
        <ArtifactImage label="Side-by-side" artifactId={figureEvidence.visual_assets.comparison_image} />
        <ArtifactImage label="Difference map" artifactId={figureEvidence.visual_assets.heatmap} />
      </div>
    </div>
  );
}

function ArtifactImage({ label, artifactId }: { label: string; artifactId?: string }) {
  if (!artifactId) {
    return <div className="artifact-empty">{label} unavailable</div>;
  }
  return (
    <figure className="artifact-figure">
      <img alt={label} src={artifactUrl(artifactId)} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function CitationChecks({ result }: { result: AnalysisResult }) {
  if (!result.references.length) {
    return <EmptyPanel title="没有 DOI 信号" body="当前 PDF 文本中未抽取到 DOI-like 字符串。" />;
  }
  return (
    <div className="citation-list">
      {result.references.map((reference) => (
        <article className="citation-row" key={reference.reference_id}>
          <FileText size={18} />
          <div>
            <h3>{reference.normalized_doi}</h3>
            <p>{reference.title ?? "No title returned"}</p>
          </div>
          <span className={`status-pill ${reference.status}`}>{reference.status}</span>
        </article>
      ))}
    </div>
  );
}

function ReportView({ markdown }: { markdown: string }) {
  return (
    <div className="report-view">
      <div className="toolbar">
        <span>Markdown report</span>
        <button className="print-button" type="button" onClick={() => window.print()}>
          <Printer size={16} />
          Save as PDF
        </button>
      </div>
      <pre>{markdown}</pre>
    </div>
  );
}

function Panel({
  title,
  icon,
  children
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-panel">
      <FileSearch size={28} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
