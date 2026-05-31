from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from xml.etree import ElementTree

import httpx
from pydantic import BaseModel, Field


class KnowledgeBaseConnector(BaseModel):
    id: str
    name: str
    coverage: str
    auth: str
    status: str
    endpoint: str
    capabilities: list[str] = Field(default_factory=list)
    note: str = ""


class KnowledgeSearchResult(BaseModel):
    source: str
    title: str
    year: int | None = None
    authors: list[str] = Field(default_factory=list)
    venue: str | None = None
    doi: str | None = None
    url: str | None = None
    citation_count: int | None = None
    evidence_role: str


class KnowledgeSearchResponse(BaseModel):
    query: str
    connectors: list[KnowledgeBaseConnector]
    results: list[KnowledgeSearchResult]


CONNECTORS = [
    KnowledgeBaseConnector(
        id="openalex",
        name="OpenAlex",
        coverage="论文、作者、机构、期刊、概念和开放获取线索",
        auth="公开 API",
        status="connected",
        endpoint="https://api.openalex.org/works",
        capabilities=["题名/摘要检索", "DOI 核验", "引用量", "开放获取链接"],
    ),
    KnowledgeBaseConnector(
        id="crossref",
        name="Crossref",
        coverage="出版商登记的 DOI、期刊、会议、图书和撤稿/更正元数据",
        auth="公开 API",
        status="connected",
        endpoint="https://api.crossref.org/works",
        capabilities=["DOI 元数据", "出版记录", "期刊来源", "参考文献线索"],
    ),
    KnowledgeBaseConnector(
        id="semantic_scholar",
        name="Semantic Scholar",
        coverage="论文语义检索、作者、引用网络和影响力指标",
        auth="可选 API Key",
        status="connected",
        endpoint="https://api.semanticscholar.org/graph/v1/paper/search",
        capabilities=["语义检索", "引用图谱", "作者消歧", "开放 PDF 线索"],
    ),
    KnowledgeBaseConnector(
        id="arxiv",
        name="arXiv",
        coverage="预印本论文，覆盖计算机、数学、物理等学科",
        auth="公开 API",
        status="connected",
        endpoint="https://export.arxiv.org/api/query",
        capabilities=["预印本检索", "版本线索", "作者与摘要", "PDF 入口"],
    ),
    KnowledgeBaseConnector(
        id="pubmed",
        name="PubMed / NCBI",
        coverage="生命科学与医学论文记录",
        auth="公开 API，可选 API Key",
        status="connected",
        endpoint="https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
        capabilities=["医学文献检索", "PMID 核验", "期刊元数据", "摘要入口"],
    ),
]


async def search_knowledge_bases(query: str, limit: int = 8) -> KnowledgeSearchResponse:
    normalized_limit = max(1, min(limit, 12))
    per_source_limit = max(2, min(5, normalized_limit))
    timeout = httpx.Timeout(5.0, connect=2.0)
    headers = {"User-Agent": "PaperHunterHackathon/0.1 (https://paperhunt.lol)"}

    async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True) as client:
        searches = [
            _search_openalex(client, query, per_source_limit),
            _search_crossref(client, query, per_source_limit),
            _search_semantic_scholar(client, query, per_source_limit),
            _search_arxiv(client, query, per_source_limit),
            _search_pubmed(client, query, per_source_limit),
        ]
        settled = await asyncio.gather(*searches, return_exceptions=True)

    results: list[KnowledgeSearchResult] = []
    connectors = [connector.model_copy() for connector in CONNECTORS]
    for index, source_result in enumerate(settled):
        if isinstance(source_result, Exception):
            connectors[index].status = "degraded"
            connectors[index].note = "当前网络或上游 API 暂时不可用，系统会继续使用其他论文库。"
            continue
        results.extend(source_result)

    return KnowledgeSearchResponse(
        query=query,
        connectors=connectors,
        results=_dedupe_results(results)[:normalized_limit],
    )


def list_connectors() -> list[KnowledgeBaseConnector]:
    return [connector.model_copy() for connector in CONNECTORS]


async def _search_openalex(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[KnowledgeSearchResult]:
    response = await client.get(
        "https://api.openalex.org/works",
        params={"search": query, "per-page": limit},
    )
    response.raise_for_status()
    data = response.json()
    results = []
    for item in data.get("results", []):
        authors = [
            authorship.get("author", {}).get("display_name", "")
            for authorship in item.get("authorships", [])[:3]
        ]
        primary_location = item.get("primary_location") or {}
        source = (primary_location.get("source") or {}).get("display_name")
        results.append(
            KnowledgeSearchResult(
                source="OpenAlex",
                title=item.get("display_name") or "Untitled work",
                year=item.get("publication_year"),
                authors=[author for author in authors if author],
                venue=source,
                doi=_clean_doi(item.get("doi")),
                url=item.get("doi") or item.get("id"),
                citation_count=item.get("cited_by_count"),
                evidence_role="用于核验论文是否存在公开元数据、开放获取版本和引用影响力线索。",
            )
        )
    return results


async def _search_crossref(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[KnowledgeSearchResult]:
    response = await client.get(
        "https://api.crossref.org/works",
        params={"query": query, "rows": limit},
    )
    response.raise_for_status()
    data = response.json()
    results = []
    for item in data.get("message", {}).get("items", []):
        title = _first(item.get("title")) or "Untitled Crossref record"
        authors = [
            " ".join(part for part in [author.get("given"), author.get("family")] if part)
            for author in item.get("author", [])[:3]
        ]
        results.append(
            KnowledgeSearchResult(
                source="Crossref",
                title=title,
                year=_crossref_year(item),
                authors=[author for author in authors if author],
                venue=_first(item.get("container-title")),
                doi=item.get("DOI"),
                url=item.get("URL"),
                citation_count=item.get("is-referenced-by-count"),
                evidence_role="用于核验 DOI、出版商登记记录、期刊/会议来源和出版时间。",
            )
        )
    return results


async def _search_semantic_scholar(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[KnowledgeSearchResult]:
    response = await client.get(
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={
            "query": query,
            "limit": limit,
            "fields": "title,year,authors,venue,url,externalIds,citationCount",
        },
    )
    response.raise_for_status()
    data = response.json()
    results = []
    for item in data.get("data", []):
        external_ids = item.get("externalIds") or {}
        authors = [author.get("name", "") for author in item.get("authors", [])[:3]]
        results.append(
            KnowledgeSearchResult(
                source="Semantic Scholar",
                title=item.get("title") or "Untitled Semantic Scholar paper",
                year=item.get("year"),
                authors=[author for author in authors if author],
                venue=item.get("venue") or None,
                doi=external_ids.get("DOI"),
                url=item.get("url"),
                citation_count=item.get("citationCount"),
                evidence_role="用于补充语义相似论文、作者网络和引用图谱线索。",
            )
        )
    return results


async def _search_arxiv(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[KnowledgeSearchResult]:
    response = await client.get(
        "https://export.arxiv.org/api/query",
        params={"search_query": f"all:{query}", "start": 0, "max_results": limit},
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.text)
    namespace = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    results = []
    for entry in root.findall("atom:entry", namespace):
        title = (entry.findtext("atom:title", default="", namespaces=namespace) or "").strip()
        published = entry.findtext("atom:published", default="", namespaces=namespace)
        authors = [
            (author.findtext("atom:name", default="", namespaces=namespace) or "").strip()
            for author in entry.findall("atom:author", namespace)[:3]
        ]
        doi = entry.findtext("arxiv:doi", default="", namespaces=namespace) or None
        results.append(
            KnowledgeSearchResult(
                source="arXiv",
                title=" ".join(title.split()) or "Untitled arXiv preprint",
                year=_year_from_date(published),
                authors=[author for author in authors if author],
                venue="arXiv",
                doi=doi,
                url=entry.findtext("atom:id", default="", namespaces=namespace) or None,
                evidence_role="用于发现预印本版本、早期论文来源和可能的投稿前版本差异。",
            )
        )
    return results


async def _search_pubmed(
    client: httpx.AsyncClient, query: str, limit: int
) -> list[KnowledgeSearchResult]:
    search_response = await client.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        params={"db": "pubmed", "term": query, "retmode": "json", "retmax": limit},
    )
    search_response.raise_for_status()
    ids = search_response.json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []

    summary_response = await client.get(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
        params={"db": "pubmed", "id": ",".join(ids), "retmode": "json"},
    )
    summary_response.raise_for_status()
    data = summary_response.json().get("result", {})
    results = []
    for pubmed_id in ids:
        item = data.get(pubmed_id, {})
        authors = [author.get("name", "") for author in item.get("authors", [])[:3]]
        results.append(
            KnowledgeSearchResult(
                source="PubMed",
                title=item.get("title") or "Untitled PubMed record",
                year=_year_from_date(item.get("pubdate", "")),
                authors=[author for author in authors if author],
                venue=item.get("fulljournalname") or item.get("source"),
                doi=_article_doi(item),
                url=f"https://pubmed.ncbi.nlm.nih.gov/{pubmed_id}/",
                citation_count=None,
                evidence_role="用于核验医学/生命科学论文的 PMID、期刊来源和正式数据库记录。",
            )
        )
    return results


def _dedupe_results(results: list[KnowledgeSearchResult]) -> list[KnowledgeSearchResult]:
    seen: set[str] = set()
    by_source: dict[str, list[KnowledgeSearchResult]] = {}
    for result in results:
        by_source.setdefault(result.source, []).append(result)

    deduped = []
    while any(by_source.values()):
        for source in list(by_source):
            if not by_source[source]:
                continue
            result = by_source[source].pop(0)
            key = (result.doi or f"{result.title}:{result.year}").lower().strip()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(result)
    return deduped


def _clean_doi(value: str | None) -> str | None:
    if not value:
        return None
    return value.replace("https://doi.org/", "").strip()


def _first(value: Any) -> str | None:
    if isinstance(value, list) and value:
        return str(value[0])
    if isinstance(value, str):
        return value
    return None


def _crossref_year(item: dict[str, Any]) -> int | None:
    for field in ("published-print", "published-online", "published"):
        date_parts = item.get(field, {}).get("date-parts", [])
        if date_parts and date_parts[0]:
            return int(date_parts[0][0])
    return None


def _year_from_date(value: str | None) -> int | None:
    if not value:
        return None
    for token in value.replace("-", " ").split():
        if token.isdigit() and len(token) == 4:
            return int(token)
    return None


def _article_doi(item: dict[str, Any]) -> str | None:
    for article_id in item.get("articleids", []):
        if article_id.get("idtype") == "doi":
            return article_id.get("value")
    return None


def utc_now() -> datetime:
    return datetime.now(UTC)
