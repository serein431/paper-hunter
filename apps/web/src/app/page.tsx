"use client";

import type {
  AnalysisResult,
  EvidenceCard,
  KnowledgeBaseConnector,
  KnowledgeSearchResult,
  ModelRuntimeConfig,
  SampleCase
} from "@paper-hunter/types";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  DollarSign,
  Eye,
  FileSearch,
  FileText,
  FlaskConical,
  GraduationCap,
  ImageIcon,
  Landmark,
  LockKeyhole,
  Newspaper,
  Printer,
  Radar,
  Rocket,
  Scale,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Timer,
  Upload,
  Users,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  artifactUrl,
  createSampleTask,
  fetchKnowledgeBases,
  fetchModelConfig,
  fetchSamples,
  saveModelConfig,
  searchKnowledgeBases,
  uploadPdf
} from "@/lib/api";

type TabId = "dashboard" | "evidence" | "images" | "citations" | "report";
type DemoStatus = "idle" | "running" | "done" | "error";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "dashboard", label: "风险仪表盘" },
  { id: "evidence", label: "证据中心" },
  { id: "images", label: "图像复核" },
  { id: "citations", label: "引用核验" },
  { id: "report", label: "报告导出" }
];

const severityLabel: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重"
};

const agentOnboardingPrompt = `你是一个接入 Paper Hunter 的科研诚信 Agent。

目标：
不要直接判定论文造假，只输出可复核证据、风险优先级和下一步人工核验建议。

服务地址：
https://paper-hunter-api.vercel.app

可用接口：
1. 健康检查：GET /api/health
2. 查看演示样例：GET /api/samples
3. 创建扫描任务：POST /api/tasks
   - multipart sample_id=synthetic-paper，可跑演示样例
   - multipart file=@paper.pdf，可上传真实 PDF
4. 查询扫描结果：GET /api/tasks/{task_id}
5. 获取证据卡：GET /api/tasks/{task_id}/evidence
6. 导出 Markdown 报告：GET /api/tasks/{task_id}/report
7. 跨论文库检索：GET /api/knowledge-search?query={title_or_doi}&limit=8

工作流程：
1. 先确认用户要扫描样例还是上传 PDF。
2. 调用 /api/tasks 创建任务，拿到 task_id、risk_score、evidence。
3. 把 evidence 按严重程度排序，解释每条证据的方法、位置、置信度和建议动作。
4. 如涉及 DOI、题名、作者或引用问题，调用 /api/knowledge-search 做外部论文库核验。
5. 最后输出「风险摘要」「证据卡」「需要人工复核的材料」「谨慎结论」。

语言边界：
禁止使用“实锤”“论文造假已成立”“作者伪造数据”等最终判决。
统一使用“疑似异常”“需要结合原始数据进一步复核”“当前证据不足以支持最终结论”。`;

const proofPoints = [
  "免费初筛",
  "疑点触发付费",
  "证据包可下载",
  "真实 PDF 扫描"
];

const demoStages = [
  {
    title: "接收论文",
    body: "读取 PDF 的文本层、图片、页码和 DOI 线索。"
  },
  {
    title: "抽取图像",
    body: "把论文里的图片候选拆出来，准备做相似度比对。"
  },
  {
    title: "寻找疑点",
    body: "检查图片复用、隐藏提示词、引用异常等风险信号。"
  },
  {
    title: "生成证据",
    body: "把可疑位置、方法、置信度和下一步动作整理成证据卡。"
  },
  {
    title: "输出报告",
    body: "给出风险分、证据包和可下载的复核报告。"
  }
];

const demoLogs = [
  "已接收风险示例论文",
  "正在拆解 PDF 页面和文本层",
  "正在抽取论文内嵌图片",
  "正在比对图片指纹和差异热图",
  "正在扫描隐藏 AI 审稿提示词",
  "正在核验 DOI 和引用线索",
  "正在生成证据卡和复核报告"
];

const evidenceTypeLabel: Record<EvidenceCard["type"], string> = {
  figure_similarity: "图片相似",
  image_clone: "图片复用",
  western_blot_anomaly: "实验图异常",
  citation_not_found: "引用未找到",
  citation_mismatch: "引用不匹配",
  citation_not_supporting_claim: "引用不支撑结论",
  retracted_reference: "撤稿引用",
  data_anomaly: "数据异常",
  paper_mill_signal: "论文工厂信号",
  hidden_prompt: "隐藏提示词",
  metadata_anomaly: "元数据异常"
};

const evidenceCopy: Partial<
  Record<EvidenceCard["type"], { title: string; claim: string; method: string; action: string }>
> = {
  figure_similarity: {
    title: "发现疑似重复使用的图片",
    claim: "论文中有两张图片高度相似，需要人工确认是否是同一实验图被重复使用。",
    method: "图片指纹比对 + 差异热图",
    action: "优先查看对比图，必要时要求作者提供原始实验图片。"
  },
  hidden_prompt: {
    title: "发现隐藏的 AI 审稿提示词",
    claim: "PDF 文本层中出现不应展示给读者的 AI 指令，可能影响审稿或阅读过程。",
    method: "隐藏文本层扫描",
    action: "检查 PDF 源文件和导出流程，确认提示词是否被误植或故意隐藏。"
  },
  citation_not_found: {
    title: "发现需要核验的引用",
    claim: "系统抽取到 DOI 或引用线索，但未能稳定匹配到公开记录。",
    method: "DOI 抽取 + 引用查询",
    action: "人工打开原始文献记录，确认引用是否真实、是否支撑文中说法。"
  }
};

const reviewStatusLabel: Record<string, string> = {
  pending: "待复核",
  confirmed: "已确认",
  rejected: "已排除",
  needs_original_data: "需原始数据",
  escalated: "已升级",
  resolved: "已处理"
};

const referenceStatusLabel: Record<string, string> = {
  unchecked: "未检查",
  found: "已找到",
  not_found: "未找到",
  network_error: "网络异常",
  demo_fallback: "演示匹配"
};

const defaultModelConfig: ModelRuntimeConfig = {
  provider: "openai-compatible",
  display_name: "OpenAI-compatible model",
  base_url: "https://api.openai.com/v1",
  model: "paper-reviewer-model",
  api_key_configured: false,
  temperature: 0.2,
  use_for: ["证据解释", "引用核验", "报告润色"],
  status: "waiting_for_user_model"
};

export default function Home() {
  const [samples, setSamples] = useState<SampleCase[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [demoStatus, setDemoStatus] = useState<DemoStatus>("idle");
  const [demoProgress, setDemoProgress] = useState(0);
  const [demoStage, setDemoStage] = useState(0);
  const [modelConfig, setModelConfig] = useState<ModelRuntimeConfig>(defaultModelConfig);
  const [modelKey, setModelKey] = useState("");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelMessage, setModelMessage] = useState("等待配置团队自己的模型");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseConnector[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState("AI generated scientific paper detection");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("已准备连接多论文库");

  useEffect(() => {
    fetchSamples()
      .then(setSamples)
      .catch(() => {
        setSamples([
          {
            id: "synthetic-paper",
            name: "风险示例论文",
            description: "内置 PDF，包含图片复用、DOI 和隐藏提示词等风险信号。",
            source_type: "generated"
          }
        ]);
      });
  }, []);

  useEffect(() => {
    fetchModelConfig()
      .then(setModelConfig)
      .catch(() => setModelConfig(defaultModelConfig));
    fetchKnowledgeBases()
      .then(setKnowledgeBases)
      .catch(() => {
        setKnowledgeBases([
          {
            id: "openalex",
            name: "OpenAlex",
            coverage: "论文、作者、机构、期刊、概念和开放获取线索",
            auth: "公开 API",
            status: "connected",
            endpoint: "https://api.openalex.org/works",
            capabilities: ["题名/摘要检索", "DOI 核验"],
            note: ""
          },
          {
            id: "crossref",
            name: "Crossref",
            coverage: "出版商登记的 DOI 和出版元数据",
            auth: "公开 API",
            status: "connected",
            endpoint: "https://api.crossref.org/works",
            capabilities: ["DOI 元数据", "出版记录"],
            note: ""
          }
        ]);
      });
  }, []);

  const filteredEvidence = useMemo(() => {
    if (!result) return [];
    return filter === "all" ? result.evidence : result.evidence.filter((card) => card.type === filter);
  }, [filter, result]);

  function scrollToDemo() {
    document.getElementById("live-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToOnsiteDemo() {
    document.getElementById("onsite-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateDemoProgress(nextProgress: number) {
    const cappedProgress = Math.max(0, Math.min(nextProgress, 100));
    setDemoProgress(cappedProgress);
    setDemoStage(Math.min(demoStages.length - 1, Math.floor(cappedProgress / 22)));
  }

  async function runSample(sampleId: string, focus: "showcase" | "workspace" = "workspace") {
    const targetScroll = focus === "showcase" ? scrollToOnsiteDemo : scrollToDemo;
    setLoading(true);
    setError(null);
    setDemoStatus("running");
    updateDemoProgress(3);
    window.setTimeout(targetScroll, 80);

    let progress = 3;
    const progressTimer = window.setInterval(() => {
      progress = Math.min(progress + 8, 92);
      updateDemoProgress(progress);
    }, 260);

    const startedAt = Date.now();
    try {
      const nextResult = await createSampleTask(sampleId);
      const elapsed = Date.now() - startedAt;
      if (elapsed < 2300) {
        await new Promise((resolve) => window.setTimeout(resolve, 2300 - elapsed));
      }
      window.clearInterval(progressTimer);
      updateDemoProgress(100);
      setResult(nextResult);
      setActiveTab("dashboard");
      setDemoStatus("done");
      if (focus === "workspace") {
        window.setTimeout(scrollToDemo, 80);
      }
    } catch (runError) {
      window.clearInterval(progressTimer);
      setError(runError instanceof Error ? runError.message : "样例扫描失败");
      setDemoStatus("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setDemoStatus("running");
    updateDemoProgress(3);

    let progress = 3;
    const progressTimer = window.setInterval(() => {
      progress = Math.min(progress + 7, 92);
      updateDemoProgress(progress);
    }, 280);

    try {
      const nextResult = await uploadPdf(file);
      window.clearInterval(progressTimer);
      updateDemoProgress(100);
      setResult(nextResult);
      setActiveTab("dashboard");
      setDemoStatus("done");
      window.setTimeout(scrollToDemo, 80);
    } catch (uploadError) {
      window.clearInterval(progressTimer);
      setError(uploadError instanceof Error ? uploadError.message : "上传扫描失败");
      setDemoStatus("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveModelConfig() {
    setModelSaving(true);
    setModelMessage("正在保存模型配置");
    try {
      const saved = await saveModelConfig({ ...modelConfig, api_key: modelKey });
      setModelConfig(saved);
      setModelKey("");
      setModelMessage(saved.api_key_configured ? "模型已接入，密钥不会回显到前端" : "模型参数已保存，等待配置 API Key");
    } catch (saveError) {
      setModelMessage(saveError instanceof Error ? saveError.message : "模型配置保存失败");
    } finally {
      setModelSaving(false);
    }
  }

  async function handleKnowledgeSearch() {
    if (!knowledgeQuery.trim()) return;
    setKnowledgeSearching(true);
    setKnowledgeMessage("正在跨库检索论文记录");
    try {
      const response = await searchKnowledgeBases(knowledgeQuery.trim(), 8);
      setKnowledgeBases(response.connectors);
      setKnowledgeResults(response.results);
      setKnowledgeMessage(response.results.length ? `已聚合 ${response.results.length} 条论文线索` : "没有检索到稳定匹配结果");
    } catch (searchError) {
      setKnowledgeMessage(searchError instanceof Error ? searchError.message : "论文库检索失败");
    } finally {
      setKnowledgeSearching(false);
    }
  }

  return (
    <main className="app-shell">
      <Hero onRunDemo={() => void runSample("synthetic-paper", "showcase")} onJumpToDemo={scrollToOnsiteDemo} loading={loading} />
      <MarketReality />
      <StoryStrip />
      <AiLoopStory />
      <OnsiteDemo
        demoProgress={demoProgress}
        demoStage={demoStage}
        demoStatus={demoStatus}
        error={error}
        loading={loading}
        result={result}
        onJumpToUpload={scrollToDemo}
        onRunDemo={() => void runSample("synthetic-paper", "showcase")}
      />
      <AudienceSection />
      <PositioningSection />
      <PricingSection />
      <ModelKnowledgeSection
        knowledgeBases={knowledgeBases}
        knowledgeMessage={knowledgeMessage}
        knowledgeQuery={knowledgeQuery}
        knowledgeResults={knowledgeResults}
        knowledgeSearching={knowledgeSearching}
        modelConfig={modelConfig}
        modelKey={modelKey}
        modelMessage={modelMessage}
        modelSaving={modelSaving}
        onKnowledgeQueryChange={setKnowledgeQuery}
        onKnowledgeSearch={() => void handleKnowledgeSearch()}
        onModelChange={setModelConfig}
        onModelKeyChange={setModelKey}
        onModelSave={() => void handleSaveModelConfig()}
      />
      <AgentIntegrationSection />

      <section className="demo-section" id="live-demo">
        <div className="section-heading">
        <p className="eyebrow">扫描工作台</p>
          <h2>上传论文，立即生成可复核结果。</h2>
          <p>
            Paper Hunter 会把论文拆成风险分、证据卡、图片对比、引用核验和报告，让复核者先看到问题在哪里。
          </p>
        </div>

        <section className="launch-strip" aria-label="Paper scan launcher">
          <label className="upload-zone">
            <Upload size={24} />
            <span>上传论文 PDF</span>
            <small>先免费扫描，只有扫出疑点才进入付费复核。</small>
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
                <span>{sampleLabel(sample)}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>

        {loading && (
          <div className="status-banner">
            <FileSearch size={18} />
            <span>正在拆 PDF、抓图片、比对相似图、生成证据卡...</span>
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
              <p className="rail-kicker">扫描结果</p>
              <h2>{sourceLabel(result.task.source_label)}</h2>
              <dl>
                <Metric label="风险分" value={String(result.task.risk_score)} tone="risk" />
                <Metric label="证据卡" value={String(result.task.evidence_count)} />
                <Metric label="图片候选" value={String(result.task.image_count)} />
                <Metric label="DOI 信号" value={String(result.task.reference_count)} />
              </dl>
              <div className="method-stack">
                <span>PDF 图像抽取</span>
                <span>图片指纹</span>
                <span>差异热图</span>
                <span>隐藏文本扫描</span>
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
          <section className="scan-placeholder">
            <div className="placeholder-score">
              <Radar size={34} />
              <strong>等待第一篇 PDF</strong>
            </div>
            <div>
              <h2>先让机器筛一遍，再决定要不要花钱。</h2>
              <p>没有疑点就免费结束；出现疑点，再解锁证据包、图像对比和复核报告。</p>
            </div>
          </section>
        )}
      </section>
      <TechnicalImplementation />
      <ProductRoadmap />
      <TeamSection />
    </main>
  );
}

function Hero({
  onRunDemo,
  onJumpToDemo,
  loading
}: {
  onRunDemo: () => void;
  onJumpToDemo: () => void;
  loading: boolean;
}) {
  return (
    <section className="hero-stage">
      <nav className="site-nav" aria-label="Product navigation">
        <div className="brand-mark">
          <SearchCheck size={22} />
          <span>Paper Hunter</span>
        </div>
        <button className="nav-demo-button" type="button" onClick={onJumpToDemo}>
          <Eye size={16} />
          看扫描流程
        </button>
      </nav>

      <div className="hero-copy">
        <div className="hero-manifesto">
          <p className="hero-domain-word">paperhunt.lol</p>
          <h1>lol 可以是😀，学术不能是玩笑。</h1>
          <p>任何质疑，都必须回到可复核证据。</p>
        </div>

        <div className="hero-product-intro">
          <div className="hero-kicker-row">
            <p className="eyebrow">面向 AI 论文时代的科研诚信工具</p>
            <span>#2026AIAgent清客松</span>
          </div>
          <strong>Paper Hunter · 论文打假人</strong>
          <p className="hero-lede">
            上传论文 PDF，先免费完成风险初筛。没有疑点，流程结束；出现风险信号，再解锁证据卡、图像对比和复核报告。
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-action" type="button" onClick={onRunDemo} disabled={loading}>
            <Rocket size={18} />
            {loading ? "正在扫描" : "运行风险样例"}
          </button>
          <button className="secondary-action" type="button" onClick={onJumpToDemo}>
            <Upload size={18} />
            上传真实论文
          </button>
        </div>
        <div className="hero-metrics" aria-label="Product metrics">
          <span>
            <strong>30s</strong>
            初筛反馈
          </span>
          <span>
            <strong>¥0</strong>
            无疑点免费
          </span>
          <span>
            <strong>付费</strong>
            只为证据付费
          </span>
        </div>
        <div className="proof-row" aria-label="Product proof points">
          {proofPoints.map((point) => (
            <span key={point}>
              <CheckCircle2 size={15} />
              {point}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function MarketReality() {
  const marketStats = [
    {
      icon: <GraduationCap size={22} />,
      value: "2.22 亿",
      label: "全球高等教育在读学生",
      note: "每一届毕业、投稿、评审，都会产生海量论文和学术文本。"
    },
    {
      icon: <FileText size={22} />,
      value: "300 万+",
      label: "同行评审文章年产量",
      note: "知识生产已经是全球级流水线，人工逐篇初筛越来越吃力。"
    },
    {
      icon: <Database size={22} />,
      value: "90%",
      label: "全球论文记录集中在 STM 领域",
      note: "科学、技术、医学论文尤其依赖图像、数据、引用和复现实验。"
    },
    {
      icon: <AlertTriangle size={22} />,
      value: "1 万+",
      label: "2023 年撤稿量创纪录",
      note: "撤稿背后有诚实错误，也有论文工厂、同行评审操纵和伪造。"
    }
  ];

  return (
    <section className="market-section">
      <div className="market-copy">
        <p className="eyebrow">市场现实</p>
        <h2>论文不应该变成互联网知识的 slop。</h2>
        <p>
          论文原本是人类思想、实验和方法的结晶。但当教育规模、发表压力、AI 生成和论文工厂叠在一起，
          “可信知识”正在变成一个需要基础设施守护的问题。
        </p>
      </div>

      <div className="market-grid" aria-label="Academic integrity market signals">
        {marketStats.map((stat) => (
          <article className="market-card" key={stat.label}>
            <div className="market-icon">{stat.icon}</div>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
            <p>{stat.note}</p>
          </article>
        ))}
      </div>

      <div className="market-thesis">
        <Sparkles size={22} />
        <div>
          <strong>Paper Hunter 的切入点不是替人下判决，而是让每一次质疑先回到证据。</strong>
          <p>先免费筛风险，再把疑点做成可追问、可复查、可交给机构流程处理的证据包。</p>
        </div>
      </div>

      <div className="market-sources" aria-label="数据来源">
        <a href="https://www.worldbank.org/en/topic/tertiaryeducation" rel="noreferrer" target="_blank">World Bank 高等教育数据</a>
        <a href="https://stm-assoc.org/wp-content/uploads/2024/08/2018_10_04_STM_Report_2018-1.pdf" rel="noreferrer" target="_blank">STM Report 年发文量</a>
        <a href="https://stm-assoc.org/oa-dashboard/oa-dashboard-2024/open-access-uptake-by-discipline/" rel="noreferrer" target="_blank">STM OA Dashboard 2024</a>
        <a href="https://www.nature.com/articles/d41586-023-03974-8" rel="noreferrer" target="_blank">Nature 2023 撤稿记录</a>
      </div>
    </section>
  );
}

function StoryStrip() {
  return (
    <section className="story-strip">
      <div className="story-lead">
        <p className="eyebrow">产品理念</p>
        <h2>我们不当法官，我们当第一道安检门。</h2>
      </div>
      <div className="story-grid">
        <MiniClaim
          icon={<Zap size={19} />}
          title="问题变多了"
          body="AI 写作、图片复用、隐藏提示词、引用污染，让普通人很难第一眼判断风险。"
        />
        <MiniClaim
          icon={<ClipboardCheck size={19} />}
          title="复核太贵了"
          body="正式调查需要专家、原始数据和机构流程，但很多 PDF 连要不要复核都没人先筛。"
        />
        <MiniClaim
          icon={<ShieldCheck size={19} />}
          title="我们给证据"
          body="只把可疑信号整理成证据卡，明确方法、位置、置信度和下一步动作。"
        />
      </div>
    </section>
  );
}

function AiLoopStory() {
  const steps = [
    {
      actor: "学生",
      title: "先让 AI 写一版",
      body: "摘要、引言、讨论先搭出来，看起来像一篇完整论文。"
    },
    {
      actor: "导师",
      title: "再让 AI 批一遍",
      body: "导师时间不够，把稿子交给 AI 做结构、逻辑和语言意见。"
    },
    {
      actor: "学生",
      title: "拿 AI 意见再让 AI 改",
      body: "学生把导师的 AI 批注复制回去，让另一个 AI 继续润色。"
    },
    {
      actor: "导师",
      title: "改完再交给 AI 看",
      body: "新版本再回到导师，导师继续用 AI 查问题，循环开始加速。"
    }
  ];

  return (
    <section className="ai-loop-section">
      <div className="ai-loop-copy">
        <p className="eyebrow">AI 论文循环</p>
        <h2>一篇论文开始在 AI 之间来回传球。</h2>
        <p>
          学生用 AI 写，导师用 AI 批，学生再用 AI 按导师的 AI 意见改，改完再交回给导师的 AI。
          每个人都参与了，但最后没人说得清：哪些内容被谁判断过，哪些风险真正被人看见过。
        </p>
      </div>

      <div className="loop-board" aria-label="AI paper revision loop">
        {steps.map((step, index) => (
          <article className="loop-step" key={`${step.actor}-${step.title}`}>
            <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
            <strong>{step.actor}</strong>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            {index < steps.length - 1 ? (
              <ArrowRight className="step-arrow" size={18} />
            ) : (
              <span className="loop-back">
                <ArrowRight size={16} />
                回到下一轮
              </span>
            )}
          </article>
        ))}
      </div>

      <div className="loop-punchline">
        <Sparkles size={20} />
        <div>
          <h3>Paper Hunter 要做的不是反 AI，而是给这个循环加一张可追溯的风险底片。</h3>
          <p>谁都可以用 AI，但每篇论文都应该留下证据：哪里可疑、为什么可疑、下一步该人工核验什么。</p>
        </div>
      </div>
    </section>
  );
}

function OnsiteDemo({
  demoProgress,
  demoStage,
  demoStatus,
  error,
  loading,
  result,
  onJumpToUpload,
  onRunDemo
}: {
  demoProgress: number;
  demoStage: number;
  demoStatus: DemoStatus;
  error: string | null;
  loading: boolean;
  result: AnalysisResult | null;
  onJumpToUpload: () => void;
  onRunDemo: () => void;
}) {
  const activeLogCount =
    demoStatus === "idle" ? 2 : demoStatus === "done" ? demoLogs.length : Math.min(demoLogs.length, demoStage + 3);
  const visibleEvidence = result?.evidence.slice(0, 3) ?? [];

  return (
    <section className="onsite-demo-section" id="onsite-demo">
      <div className="onsite-demo-copy">
        <p className="eyebrow">现场演示</p>
        <h2>点击一次，真的跑完一篇论文扫描。</h2>
        <p>
          这不是静态截图。开始扫描后，系统会调用后端分析一篇带有风险信号的 PDF，并把进度、日志、风险分和证据卡同步展示出来。
        </p>
        <div className="demo-actions">
          <button className="primary-action" type="button" onClick={onRunDemo} disabled={loading}>
            <Radar size={18} />
            {loading ? "扫描中" : "开始现场演示"}
          </button>
          <button className="secondary-light-action" type="button" onClick={onJumpToUpload}>
            <Upload size={18} />
            上传自己的论文
          </button>
        </div>
      </div>

      <div className="live-demo-console" aria-live="polite">
        <div className="console-topbar">
          <span>论文风险扫描台</span>
          <strong>{demoStatusLabel(demoStatus)}</strong>
        </div>
        <div className="console-body">
          <div className="scan-visual">
            <div className={demoStatus === "running" ? "demo-paper scanning" : "demo-paper"}>
              <span>PDF</span>
              <i />
              <i />
              <i />
              <i />
              <div className="figure-pair">
                <b />
                <b />
              </div>
              <div className="scan-beam" />
            </div>
            <div className="demo-score">
              <span>风险分</span>
              <strong>{result ? result.task.risk_score : demoStatus === "idle" ? "--" : "..."}</strong>
            </div>
          </div>

          <div className="demo-progress-block">
            <div className="progress-label">
              <span>{demoStages[demoStage]?.title ?? "准备扫描"}</span>
              <strong>{Math.round(demoProgress)}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${demoProgress}%` }} />
            </div>
            <div className="stage-list">
              {demoStages.map((stage, index) => (
                <div
                  className={index < demoStage ? "stage done" : index === demoStage ? "stage active" : "stage"}
                  key={stage.title}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{stage.title}</strong>
                    <p>{stage.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="demo-log-panel">
            <h3>实时日志</h3>
            <ul>
              {demoLogs.slice(0, activeLogCount).map((log) => (
                <li key={log}>
                  <CheckCircle2 size={15} />
                  {log}
                </li>
              ))}
              {demoStatus === "error" && error ? (
                <li className="log-error">
                  <AlertTriangle size={15} />
                  {error}
                </li>
              ) : null}
            </ul>
          </div>

          <div className="demo-evidence-preview">
            <h3>证据预览</h3>
            {visibleEvidence.length ? (
              visibleEvidence.map((card) => (
                <article key={card.evidence_id}>
                  <span className={`severity ${card.severity}`}>{severityLabel[card.severity]}</span>
                  <div>
                    <strong>{cardTitle(card)}</strong>
                    <p>{cardClaim(card)}</p>
                  </div>
                </article>
              ))
            ) : (
              <p>开始扫描后，这里会出现可疑图片、隐藏提示词、引用核验等证据卡。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AudienceSection() {
  return (
    <section className="content-band">
      <div className="section-heading">
        <p className="eyebrow">用户群体</p>
        <h2>谁会第一时间需要它？</h2>
        <p>不是所有人都要做学术调查，但很多人都需要一个便宜、快速、能解释的风险入口。</p>
      </div>
      <div className="audience-grid">
        <AudienceCard
          icon={<GraduationCap size={22} />}
          title="研究生和导师"
          body="投稿前自查，避免低级风险拖垮一篇本来可以发表的论文。"
        />
        <AudienceCard
          icon={<Newspaper size={22} />}
          title="期刊编辑和审稿人"
          body="先看机器证据卡，再决定哪些稿件值得人工重点复核。"
        />
        <AudienceCard
          icon={<Landmark size={22} />}
          title="高校与科研机构"
          body="把匿名举报、毕业审核、项目结题的初筛流程标准化。"
        />
        <AudienceCard
          icon={<Users size={22} />}
          title="媒体和公众监督"
          body="把“感觉有问题”变成“这里需要进一步核验”。"
        />
      </div>
    </section>
  );
}

function PositioningSection() {
  return (
    <section className="position-band">
      <div>
        <p className="eyebrow">产品主张</p>
        <h2>主张很简单：先筛风险，再谈结论。</h2>
        <p>
          Paper Hunter 不说“实锤”，也不替机构定性。它只做三件事：找到疑点、解释为什么可疑、告诉你下一步该找什么材料。
        </p>
      </div>
      <div className="principle-list">
        <Principle icon={<Scale size={18} />} text="不输出学术不端判决，只输出可复核证据。" />
        <Principle icon={<LockKeyhole size={18} />} text="演示环境不做长期保存，生产版接机构私有存储。" />
        <Principle icon={<Timer size={18} />} text="把几小时人工初筛压缩成一分钟以内的复核反馈。" />
        <Principle icon={<Sparkles size={18} />} text="AI 不是裁判，是帮复核者少漏看一眼的助手。" />
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section className="content-band pricing-band">
      <div className="section-heading">
        <p className="eyebrow">收费方式</p>
        <h2>先免费扫描，再为证据付费。</h2>
        <p>每篇论文都可以先做免费初筛。只有系统发现疑点，用户才需要解锁证据包和复核报告。</p>
      </div>
      <div className="pricing-grid">
        <PricingCard
          icon={<FileSearch size={22} />}
          plan="免费扫描"
          price="¥0"
          title="先扫，永远免费"
          body="上传 PDF、得到风险分、知道有没有疑点。扫不到疑点，不收钱。"
        />
        <PricingCard
          icon={<DollarSign size={22} />}
          plan="证据解锁"
          price="¥9.9 起/篇"
          title="扫到疑点再付费"
          body="解锁证据卡、图像对比、引用核验和可下载报告。适合个人投稿前自查。"
          featured
        />
        <PricingCard
          icon={<BadgeCheck size={22} />}
          plan="机构复核台"
          price="机构套餐"
          title="给实验室和期刊"
          body="批量扫描、团队复核、导出审查记录。适合期刊编辑部和科研诚信办公室。"
        />
      </div>
      <div className="pricing-advice">
        <CheckCircle2 size={18} />
        <span>
          计费规则：风险分和是否存在疑点免费展示；证据卡、图像对比、引用核验和报告导出按篇解锁。
        </span>
      </div>
    </section>
  );
}

function ModelKnowledgeSection({
  knowledgeBases,
  knowledgeMessage,
  knowledgeQuery,
  knowledgeResults,
  knowledgeSearching,
  modelConfig,
  modelKey,
  modelMessage,
  modelSaving,
  onKnowledgeQueryChange,
  onKnowledgeSearch,
  onModelChange,
  onModelKeyChange,
  onModelSave
}: {
  knowledgeBases: KnowledgeBaseConnector[];
  knowledgeMessage: string;
  knowledgeQuery: string;
  knowledgeResults: KnowledgeSearchResult[];
  knowledgeSearching: boolean;
  modelConfig: ModelRuntimeConfig;
  modelKey: string;
  modelMessage: string;
  modelSaving: boolean;
  onKnowledgeQueryChange: (value: string) => void;
  onKnowledgeSearch: () => void;
  onModelChange: (config: ModelRuntimeConfig) => void;
  onModelKeyChange: (value: string) => void;
  onModelSave: () => void;
}) {
  const connectedCount = knowledgeBases.filter((base) => base.status === "connected").length;

  return (
    <section className="model-knowledge-section">
      <div className="section-heading">
        <p className="eyebrow">模型与论文库</p>
        <h2>模型自己带，论文库系统接。</h2>
        <p>
          面向机构场景，Paper Hunter 不强绑单一模型。用户可以配置自己的推理模型，
          后端同时聚合公开论文知识库，用来核验 DOI、预印本、引用网络和医学文献记录。
        </p>
      </div>

      <div className="model-knowledge-grid">
        <article className="model-panel">
          <div className="panel-kicker">
            <Cpu size={20} />
            <span>前端配置自己的模型</span>
          </div>
          <div className="model-form">
            <label>
              <span>模型提供方</span>
              <select
                value={modelConfig.provider}
                onChange={(event) =>
                  onModelChange({
                    ...modelConfig,
                    provider: event.target.value,
                    display_name: providerLabel(event.target.value)
                  })
                }
              >
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">通义千问</option>
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
                <option value="ollama">本地 Ollama</option>
              </select>
            </label>
            <label>
              <span>Base URL</span>
              <input
                value={modelConfig.base_url}
                onChange={(event) => onModelChange({ ...modelConfig, base_url: event.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label>
              <span>模型名</span>
              <input
                value={modelConfig.model}
                onChange={(event) => onModelChange({ ...modelConfig, model: event.target.value })}
                placeholder="paper-reviewer-model"
              />
            </label>
            <label>
              <span>API Key</span>
              <input
                value={modelKey}
                onChange={(event) => onModelKeyChange(event.target.value)}
                placeholder={modelConfig.api_key_configured ? "已配置，重新输入可覆盖" : "只提交到后端，不在页面回显"}
                type="password"
              />
            </label>
            <label>
              <span>温度</span>
              <input
                inputMode="decimal"
                value={String(modelConfig.temperature)}
                onChange={(event) =>
                  onModelChange({
                    ...modelConfig,
                    temperature: Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : 0.2
                  })
                }
              />
            </label>
          </div>
          <div className="model-capability-row">
            {modelConfig.use_for.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="model-save-row">
            <button type="button" onClick={onModelSave} disabled={modelSaving}>
              <LockKeyhole size={16} />
              {modelSaving ? "保存中" : "保存模型配置"}
            </button>
            <strong>{modelMessage}</strong>
          </div>
        </article>

        <article className="knowledge-panel">
          <div className="panel-kicker">
            <Database size={20} />
            <span>后台打通论文知识库</span>
          </div>
          <div className="knowledge-search-row">
            <input
              value={knowledgeQuery}
              onChange={(event) => onKnowledgeQueryChange(event.target.value)}
              placeholder="输入论文标题、DOI、作者或主题"
            />
            <button type="button" onClick={onKnowledgeSearch} disabled={knowledgeSearching}>
              <SearchCheck size={16} />
              {knowledgeSearching ? "检索中" : "跨库检索"}
            </button>
          </div>
          <div className="knowledge-status">
            <strong>{connectedCount}/{knowledgeBases.length || 5}</strong>
            <span>{knowledgeMessage}</span>
          </div>
          <div className="connector-grid">
            {knowledgeBases.map((base) => (
              <div className={base.status === "connected" ? "connector-card" : "connector-card degraded"} key={base.id}>
                <span>{base.status === "connected" ? "已连接" : "降级"}</span>
                <strong>{base.name}</strong>
                <p>{base.coverage}</p>
              </div>
            ))}
          </div>
          <div className="knowledge-results">
            {knowledgeResults.length ? (
              knowledgeResults.slice(0, 4).map((paper) => (
                <article key={`${paper.source}-${paper.doi ?? paper.title}`}>
                  <span>{paper.source}</span>
                  <h3>{paper.title}</h3>
                  <p>{paper.year ? `${paper.year} · ` : ""}{paper.authors.slice(0, 3).join("、") || paper.venue || "公开论文记录"}</p>
                  <small>{paper.evidence_role}</small>
                </article>
              ))
            ) : (
              <div className="empty-knowledge">
                <FileSearch size={24} />
                <p>检索后会显示来自 OpenAlex、Crossref、Semantic Scholar、arXiv 和 PubMed 的论文线索。</p>
              </div>
            )}
          </div>
          <div className="knowledge-partner-callout">
            <Users size={24} />
            <div>
              <strong>欢迎各大论文库和机构合作</strong>
              <p>机构合作免费。我们先用爱发电，把科研诚信基础设施做起来。</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function AgentIntegrationSection() {
  const [copyState, setCopyState] = useState("复制给 Agent");
  const endpoints = [
    { label: "创建扫描", value: "POST /api/tasks" },
    { label: "读取证据", value: "GET /api/tasks/{task_id}" },
    { label: "论文库核验", value: "GET /api/knowledge-search" },
    { label: "导出报告", value: "GET /api/tasks/{task_id}/report" }
  ];

  async function copyOnboarding() {
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = agentOnboardingPrompt;
      textarea.setAttribute("readonly", "");
      textarea.style.left = "-9999px";
      textarea.style.position = "fixed";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    };

    try {
      let copied = false;
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
          await Promise.race([
            navigator.clipboard.writeText(agentOnboardingPrompt),
            new Promise((_, reject) => window.setTimeout(() => reject(new Error("Clipboard timeout")), 900))
          ]);
          copied = true;
        } catch {
          copied = fallbackCopy();
        }
      }
      if (!copied) {
        copied = fallbackCopy();
      }
      if (!copied) {
        throw new Error("Copy failed");
      }
      setCopyState("已复制，可直接发给 Agent");
      window.setTimeout(() => setCopyState("复制给 Agent"), 2200);
    } catch {
      setCopyState("复制失败，请手动选中文本");
      window.setTimeout(() => setCopyState("复制给 Agent"), 2600);
    }
  }

  return (
    <section className="agent-section">
      <div className="agent-heading">
        <p className="eyebrow">Agent 接入</p>
        <h2>不打开 Web UI，Agent 也能直接开工。</h2>
        <p>
          给 Agent 一段 onboarding，它就知道怎么上传论文、调用扫描接口、跨库核验、导出证据报告。
          适合接入科研助手、审稿助手、机构内部工作流和自动化复核系统。
        </p>
      </div>

      <div className="agent-grid">
        <div className="agent-flow-card">
          <div className="panel-kicker">
            <Cpu size={20} />
            <span>接入方式</span>
          </div>
          <div className="agent-flow">
            <article>
              <span>01</span>
              <strong>复制 onboarding</strong>
              <p>把右侧任务卡交给你的 Agent，不需要它理解页面。</p>
            </article>
            <ArrowRight size={18} />
            <article>
              <span>02</span>
              <strong>Agent 调接口</strong>
              <p>上传 PDF 或跑样例，拿到风险分、证据卡和报告。</p>
            </article>
            <ArrowRight size={18} />
            <article>
              <span>03</span>
              <strong>回写工作流</strong>
              <p>把疑点、证据和人工复核建议发回审稿/教学系统。</p>
            </article>
          </div>
          <div className="agent-endpoints">
            {endpoints.map((endpoint) => (
              <div key={endpoint.label}>
                <span>{endpoint.label}</span>
                <strong>{endpoint.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="agent-prompt-card">
          <div className="agent-prompt-topbar">
            <div>
              <span>AGENT_ONBOARDING.md</span>
              <strong>复制后直接投喂给 Agent</strong>
            </div>
            <button type="button" onClick={() => void copyOnboarding()}>
              <ClipboardCheck size={16} />
              {copyState}
            </button>
          </div>
          <pre>{agentOnboardingPrompt}</pre>
        </div>
      </div>
    </section>
  );
}

function TechnicalImplementation() {
  const pipelineSteps = [
    {
      icon: <Upload size={22} />,
      label: "输入",
      title: "PDF 上传",
      meta: "/api/tasks"
    },
    {
      icon: <FileText size={22} />,
      label: "拆解",
      title: "PDF 解析",
      meta: "文本 / 图片 / DOI"
    },
    {
      icon: <ImageIcon size={22} />,
      label: "取证",
      title: "图像与文本风险",
      meta: "哈希 / 差异热图 / 隐藏提示"
    },
    {
      icon: <Database size={22} />,
      label: "核验",
      title: "论文知识库",
      meta: "OpenAlex / Crossref / PubMed"
    },
    {
      icon: <Cpu size={22} />,
      label: "模型",
      title: "自带模型路由",
      meta: "证据解释 / 报告润色"
    },
    {
      icon: <BadgeCheck size={22} />,
      label: "输出",
      title: "证据包",
      meta: "证据卡 / 图像对比 / 报告"
    }
  ];

  const engineModules = [
    {
      name: "PyMuPDF",
      value: "PDF"
    },
    {
      name: "Figure Forensics",
      value: "图像"
    },
    {
      name: "Text Signals",
      value: "文本"
    },
    {
      name: "Model Gateway",
      value: "模型"
    },
    {
      name: "Knowledge APIs",
      value: "论文库"
    }
  ];

  return (
    <section className="tech-section">
      <div className="tech-heading">
        <p className="eyebrow">技术实现逻辑</p>
        <h2>从一篇 PDF 到一组可复核证据。</h2>
        <p>
          Paper Hunter 不靠一句“AI 觉得可疑”下结论。它把论文拆开，分别检查图片、文本和引用线索，
          再把每个疑点包装成能被人工追问、复查和导出的证据卡。
        </p>
      </div>

      <div className="tech-visual-flow" aria-label="技术处理流程">
        {pipelineSteps.map((step, index) => (
          <article className="tech-node" key={step.title}>
            <div className="node-icon">{step.icon}</div>
            <span>{step.label}</span>
            <h3>{step.title}</h3>
            <p>{step.meta}</p>
            {index < pipelineSteps.length - 1 ? <i aria-hidden="true" /> : null}
          </article>
        ))}
      </div>

      <div className="tech-canvas" aria-label="系统架构可视化">
        <div className="canvas-card user-side">
          <span>用户工作台</span>
          <strong>免费初筛</strong>
          <div className="mini-screen">
            <b />
            <b />
            <b />
          </div>
          <small>上传 / 进度 / 证据预览</small>
        </div>

        <div className="engine-hub">
          <div className="hub-core">
            <Radar size={26} />
            <strong>FastAPI Orchestrator</strong>
            <span>风险评分</span>
          </div>
          {engineModules.map((module, index) => (
            <article className={`engine-module module-${index + 1}`} key={module.name}>
              <span>{module.value}</span>
              <strong>{module.name}</strong>
            </article>
          ))}
        </div>

        <div className="canvas-card output-side">
          <span>付费解锁</span>
          <strong>疑点证据包</strong>
          <div className="evidence-stack">
            <b />
            <b />
            <b />
          </div>
          <small>证据卡 / 对比图 / 报告</small>
        </div>
      </div>

      <div className="tech-principle">
        <Scale size={20} />
        <span>技术边界：系统只输出证据和复核优先级，不输出学术不端判决。最终判断必须由人基于原始数据和机构流程完成。</span>
      </div>
    </section>
  );
}

function ProductRoadmap() {
  const roadmapSteps = [
    {
      icon: <Landmark size={24} />,
      label: "01",
      title: "科研论文机构接入",
      body: "面向高校、期刊、科研诚信办公室和论文知识库，提供 Web UI、API 与 Agent 接入，把初筛、复核和证据留档变成标准流程。"
    },
    {
      icon: <ShieldCheck size={24} />,
      label: "02",
      title: "真人撰写可信认证",
      body: "结合写作过程指纹、身份 ID、时间线和可选区块链存证，为真人完成的学术工作建立可复核证明，而不是只在交稿后追问结果。"
    },
    {
      icon: <Database size={24} />,
      label: "03",
      title: "True 人类智慧数据库",
      body: "沉淀经授权、可追溯、可认证的人类高等智慧作品，让高质量思想成为被尊重、被引用、也能被机器正确学习的数据资产。"
    },
    {
      icon: <Rocket size={24} />,
      label: "04",
      title: "AGI 贡献",
      body: "AI 应该建立在人类高等智慧的结晶之上，而不是互联网数字噪声的堆砌。Paper Hunter 要把可信论文与思想沉淀成面向 AGI 的干净知识底座。"
    }
  ];

  return (
    <section className="roadmap-section" id="roadmap">
      <div className="roadmap-heading">
        <p className="eyebrow">Product Roadmap</p>
        <h2>从论文打假，走向可信人类智慧基础设施。</h2>
        <p>
          Paper Hunter 的长期目标不是制造更多判决，而是把学术生产过程里的“人、证据、机构和知识资产”
          重新连接起来。
        </p>
      </div>

      <div className="roadmap-grid">
        {roadmapSteps.map((step) => (
          <article className="roadmap-card" key={step.title}>
            <div className="roadmap-card-top">
              <span>{step.label}</span>
              <div>{step.icon}</div>
            </div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        ))}
      </div>

      <div className="roadmap-thesis">
        <Sparkles size={20} />
        <strong>可信的人类智慧，应该成为下一代 AI 的训练边界和价值来源。</strong>
      </div>
    </section>
  );
}

function TeamSection() {
  const members = [
    {
      avatar: "/assets/team/kevin.png",
      name: "朱盼恒 Kevin",
      role: "队长",
      scope: "GTM、Demo、RaaS 商业化",
      body: "跨境 AI 从业者，正在和团队一起重构中国企业出海营销现状，推动营销按结果收费的 RaaS 模式。",
      proofs: ["出海营销 RaaS 推动者", "超越之路黑客松亚军", "AWS 黑客松 AI 榜冠军", "负鼠表情包 chuangbian.cc 作者"]
    },
    {
      avatar: "/assets/team/goyang.png",
      name: "戈洋",
      role: "全栈工程师",
      scope: "AI 安全、安全智能体",
      body: "本科网络空间安全，即将保研到中科院软件所。主要做 AI 安全和安全智能体方向，目前在阿里安全 AGI 实验室做安全大模型和 CTF Agent 相关工作，也在清华 Vul337 实验室做过 LLM 与二进制逆向研究。",
      proofs: ["猎豹移动黑客松冠军", "超越之路个人赛道冠军", "BEYOND Expo 黑客松特等奖", "参与阿里息壤安全大模型技术手册撰写"]
    },
    {
      avatar: "/assets/team/minyuan.png",
      name: "张志远",
      role: "全栈工程师",
      scope: "AI 开发、产品实现",
      body: "现读于河南省建业外国语中学，17 岁高中生 AI 开发者。参与猎豹移动创始人傅盛发起的黑客松活动，速通最难题并获得 Offer。",
      proofs: ["清华大学 AttraX 一等奖", "小红书黑巅受邀嘉宾", "BEYOND Expo 全场大奖最佳造物奖"]
    },
    {
      avatar: "/assets/team/mrbolt.svg",
      name: "MR.BOLT",
      role: "精神支持",
      scope: "远程陪跑、气氛维护",
      body: "一直没有真正出现，但一直以网友形态存在于项目现场。负责在关键时刻提供精神支持，让团队相信这个东西真的能跑起来。",
      proofs: ["从未缺席聊天记录", "长期在线但不一定现身", "项目精神电量补给"]
    }
  ];

  return (
    <section className="team-section">
      <div className="team-heading">
        <p className="eyebrow">团队介绍</p>
        <h2>做一个能上场演示的科研诚信产品。</h2>
        <p>我们把产品表达、工程实现和精神电量放在同一条线上：先让大家看懂，再让系统跑起来。</p>
      </div>
      <div className="team-grid">
        {members.map((member) => (
          <article className="team-card" key={member.name}>
            <img className="team-avatar" src={member.avatar} alt={`${member.name} 头像`} />
            <div>
              <span>{member.role}</span>
              <h3>{member.name}</h3>
              <strong>{member.scope}</strong>
              <p>{member.body}</p>
              <div className="team-proof-list" aria-label={`${member.name} 关键经历`}>
                {member.proofs.map((proof) => (
                  <em key={proof}>{proof}</em>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MiniClaim({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <article className="mini-claim">
      <div className="icon-chip">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function AudienceCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <article className="audience-card">
      <div className="icon-chip">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function Principle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="principle-row">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function PricingCard({
  icon,
  plan,
  price,
  title,
  body,
  featured
}: {
  icon: React.ReactNode;
  plan: string;
  price: string;
  title: string;
  body: string;
  featured?: boolean;
}) {
  return (
    <article className={featured ? "pricing-card featured" : "pricing-card"}>
      <div className="pricing-head">
        <div className="icon-chip">{icon}</div>
        <span>{plan}</span>
      </div>
      <strong>{price}</strong>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function sampleLabel(sample: SampleCase) {
  if (sample.id === "synthetic-paper") return "风险示例论文";
  if (sample.id === "private-real-case") return "扫描私有真实论文";
  return sample.name;
}

function sourceLabel(source: string | null | undefined) {
  if (!source) return "上传论文";
  if (source === "synthetic-paper") return "风险示例论文";
  if (source === "private-real-case") return "私有真实论文";
  return source;
}

function demoStatusLabel(status: DemoStatus) {
  if (status === "running") return "扫描中";
  if (status === "done") return "已生成结果";
  if (status === "error") return "扫描失败";
  return "等待开始";
}

function cardTitle(card: EvidenceCard) {
  return evidenceCopy[card.type]?.title ?? card.title;
}

function cardClaim(card: EvidenceCard) {
  return evidenceCopy[card.type]?.claim ?? card.claim;
}

function cardMethod(card: EvidenceCard) {
  return evidenceCopy[card.type]?.method ?? card.method;
}

function cardAction(card: EvidenceCard) {
  return evidenceCopy[card.type]?.action ?? card.recommended_action;
}

function reviewStatus(status: string) {
  return reviewStatusLabel[status] ?? status;
}

function referenceStatus(status: string) {
  return referenceStatusLabel[status] ?? status;
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    "openai-compatible": "OpenAI Compatible",
    deepseek: "DeepSeek",
    qwen: "通义千问",
    gemini: "Gemini",
    claude: "Claude",
    ollama: "本地 Ollama"
  };
  return labels[provider] ?? provider;
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
        <p>基于证据等级和数量生成的风险分，用来判断这篇论文是否需要进入人工复核。</p>
      </Panel>
      <Panel title="高风险证据" icon={<BadgeCheck size={18} />}>
        <div className="big-count">{high.length}</div>
        <p>建议优先人工查看图像对比和原始实验记录。</p>
      </Panel>
      <Panel title="图片异常" icon={<ImageIcon size={18} />}>
        <div className="big-count">{figure.length}</div>
        <p>系统比较 PDF 内嵌图片候选，帮助复核者优先查看相似图片。</p>
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
        <span>{evidence.length} 张证据卡</span>
        <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
          <option value="all">全部证据</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {evidenceTypeLabel[type]}
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
            <h3>{cardTitle(card)}</h3>
            <p>{cardClaim(card)}</p>
            <dl className="card-facts">
              <div>
                <dt>方法</dt>
                <dd>{cardMethod(card)}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{card.location}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{reviewStatus(card.review_status)}</dd>
              </div>
            </dl>
            <p className="action-line">{cardAction(card)}</p>
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
        <p className="eyebrow">图像复核</p>
        <h2>{cardTitle(figureEvidence)}</h2>
        <p>{cardClaim(figureEvidence)}</p>
        <p className="action-line">{cardAction(figureEvidence)}</p>
      </div>
      <div className="image-grid">
        <ArtifactImage label="并排对比图" artifactId={figureEvidence.visual_assets.comparison_image} />
        <ArtifactImage label="差异热图" artifactId={figureEvidence.visual_assets.heatmap} />
      </div>
    </div>
  );
}

function ArtifactImage({ label, artifactId }: { label: string; artifactId?: string }) {
  if (!artifactId) {
    return <div className="artifact-empty">{label} 暂不可用</div>;
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
            <p>{reference.title ?? "未返回标题"}</p>
          </div>
          <span className={`status-pill ${reference.status}`}>{referenceStatus(reference.status)}</span>
        </article>
      ))}
    </div>
  );
}

function ReportView({ markdown }: { markdown: string }) {
  return (
    <div className="report-view">
      <div className="toolbar">
        <span>复核报告</span>
        <button className="print-button" type="button" onClick={() => window.print()}>
          <Printer size={16} />
          保存为 PDF
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
