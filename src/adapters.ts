export type Verdict = 'verified' | 'fake' | 'uncertain'

export interface Claim {
  text: string
  verdict: Verdict
  confidence: number
  note: string
}

export interface AnalysisResult {
  title: string
  source: string
  publishedDate: string
  overallVerdict: Verdict
  credibilityScore: number
  claims: Claim[]
  redFlags: string[]
  supportingLinks: { label: string; url: string }[]
  analysisId: string
  articleUrl?: string
  healthArea?: string
}

function relationToVerdict(relation?: string): Verdict {
  switch ((relation ?? '').toUpperCase()) {
    case 'SUPPORTS':
      return 'verified'
    case 'CONTRADICTS':
      return 'fake'
    default:
      return 'uncertain'
  }
}

function safePercent(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  const normalized = numeric <= 1 ? numeric * 100 : numeric
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function articleUrlFromSource(source: unknown, doi: unknown): string | undefined {
  if (typeof source === 'string' && /^https?:\/\//i.test(source)) return source
  if (typeof doi === 'string' && doi.trim()) return `https://doi.org/${doi.replace(/^doi:/i, '').trim()}`
  if (typeof source === 'string' && /^\d+$/.test(source.trim())) {
    return `https://pubmed.ncbi.nlm.nih.gov/${source.trim()}/`
  }
  return undefined
}

function adaptSingleResult(data: any, analysisId: string): AnalysisResult {
  const submitted = data?.submitted_article ?? {}
  const narrative = data?.user_summary ?? {}
  const findings = Array.isArray(narrative.findings) ? narrative.findings : []
  const balance = narrative.evidence_balance ?? {}

  const supports = Number(balance.SUPPORTS ?? 0)
  const contradicts = Number(balance.CONTRADICTS ?? 0)
  const directTotal = supports + contradicts

  let overallVerdict: Verdict = 'uncertain'
  if (supports > contradicts) overallVerdict = 'verified'
  if (contradicts > supports) overallVerdict = 'fake'

  const compatibilityPercent =
    directTotal > 0 ? Math.round((supports / directTotal) * 100) : 0

  const claims: Claim[] = findings.map((finding: any) => ({
    text:
      finding.finding_pt ||
      finding.article_title_pt ||
      finding.article_title ||
      narrative.claim ||
      'Evidência encontrada',
    verdict: relationToVerdict(finding.relation),
    confidence: safePercent(finding.confidence),
    note:
      finding.rationale ||
      finding.quote_pt ||
      finding.quote ||
      'Confira o trecho e a fonte original.',
  }))

  if (!claims.length && narrative.claim) {
    claims.push({
      text: narrative.claim,
      verdict: overallVerdict,
      confidence: 0,
      note:
        narrative.interpretation ||
        'Não houve trecho independente diretamente comparável nesta execução.',
    })
  }

  const alerts = Array.isArray(data?.verification?.alerts)
    ? data.verification.alerts
    : []
  const caveats = Array.isArray(narrative.caveats) ? narrative.caveats : []

  const redFlags = [
    ...alerts.map((alert: any) => alert.detail || alert.title).filter(Boolean),
    ...caveats.filter(Boolean),
  ]

  const reportSources = Array.isArray(data?.report?.sources)
    ? data.report.sources
    : []

  const findingSources = findings
    .filter((finding: any) => finding.source_url)
    .map((finding: any) => ({
      label:
        finding.article_title_pt ||
        finding.article_title ||
        'Artigo no PubMed',
      url: finding.source_url,
    }))

  const supportingLinks = [...reportSources, ...findingSources]
    .map((source: any) => ({
      label: source.label || source.title || 'Fonte científica',
      url: source.url,
    }))
    .filter((source: any) => typeof source.url === 'string' && source.url)

  const uniqueLinks = Array.from(
    new Map(supportingLinks.map((link) => [link.url, link])).values(),
  )

  const sourceUrl = articleUrlFromSource(submitted.source, submitted.doi)

  return {
    title: submitted.title || narrative.claim || 'Artigo analisado',
    source:
      submitted.source ||
      data?.article_dossier?.publication?.journal ||
      'PubMed / PMC',
    publishedDate:
      submitted.publication_date ||
      data?.article_dossier?.publication?.publication_date ||
      '',
    overallVerdict,
    credibilityScore: compatibilityPercent,
    claims,
    redFlags,
    supportingLinks: uniqueLinks,
    analysisId,
    articleUrl: sourceUrl,
    healthArea: 'Geral',
  }
}

export function adaptBackendResult(data: any, analysisId: string): AnalysisResult {
  const article = adaptSingleResult(data, analysisId)
  const analyses = Array.isArray(data?.claim_analyses) ? data.claim_analyses : []
  if (!analyses.length) return article

  let supports = 0
  let contradicts = 0
  const claims: Claim[] = []
  const redFlags: string[] = []
  const supportingLinks: AnalysisResult['supportingLinks'] = []

  // The top-level result mirrors the first claim; count only the entries here.
  for (const [index, analysis] of analyses.entries()) {
    const claimText = analysis.claim?.text || analysis.result?.user_summary?.claim || `Alegação ${index + 1}`
    const result = adaptSingleResult(analysis.result, analysisId)
    const balance = analysis.result?.user_summary?.evidence_balance ?? {}
    supports += Number(balance.SUPPORTS ?? 0)
    contradicts += Number(balance.CONTRADICTS ?? 0)

    if (result.claims.length) {
      claims.push(...result.claims.map((finding) => ({
        ...finding,
        note: `Alegação: ${claimText}\n${finding.note}`,
      })))
    } else {
      claims.push({
        text: claimText,
        verdict: 'uncertain',
        confidence: 0,
        note: 'Não houve trecho independente diretamente comparável nesta execução.',
      })
    }
    redFlags.push(...result.redFlags.map((flag) => `${claimText}: ${flag}`))
    supportingLinks.push(...result.supportingLinks.map((link) => ({
      ...link,
      label: `${claimText} — ${link.label}`,
    })))
  }

  const directTotal = supports + contradicts
  return {
    ...article,
    overallVerdict: supports > contradicts ? 'verified' : contradicts > supports ? 'fake' : 'uncertain',
    credibilityScore: directTotal > 0 ? Math.round((supports / directTotal) * 100) : 0,
    claims,
    redFlags: [...new Set(redFlags)],
    supportingLinks,
  }
}
