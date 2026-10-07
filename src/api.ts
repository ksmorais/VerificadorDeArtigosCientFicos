export type ApiVerdict = 'verified' | 'fake' | 'uncertain'

export interface ApiClaimResult {
  text: string
  verdict: ApiVerdict
  confidence: number
  note: string
}

export interface ApiAnalysisResult {
  title: string
  source: string
  publishedDate: string
  overallVerdict: ApiVerdict
  credibilityScore: number
  claims: ApiClaimResult[]
  redFlags: string[]
  supportingLinks: { label: string; url: string }[]
  analysisId: string
  articleUrl?: string
}

type JsonRecord = Record<string, any>

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const MAX_FILE_BYTES = 25 * 1024 * 1024
const SUPPORTED_FILE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalized}`
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function parseResponse(response: Response): Promise<JsonRecord> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Erro ${response.status} ao comunicar com o backend.`
    throw new Error(message)
  }
  return data
}

async function requestJson(path: string, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  return parseResponse(response)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'))
    reader.onload = () => {
      const value = String(reader.result || '')
      const comma = value.indexOf(',')
      if (comma < 0) {
        reject(new Error('Não foi possível codificar o arquivo para envio.'))
        return
      }
      resolve(value.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function isSupportedArticleFile(file: File): boolean {
  return SUPPORTED_FILE_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_FILE_BYTES
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 50
  const normalized = numeric <= 1 ? numeric * 100 : numeric
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

function verdictFromStatus(status: unknown): ApiVerdict {
  switch (String(status || '').toUpperCase()) {
    case 'PREDOMINANTLY_COMPATIBLE':
    case 'COMPATIBLE':
    case 'SUPPORTS':
      return 'verified'
    case 'POTENTIAL_DIVERGENCE':
    case 'CONTRADICTS':
      return 'fake'
    default:
      return 'uncertain'
  }
}

function claimFromAnalysis(item: JsonRecord): ApiClaimResult {
  const result = item?.result || {}
  const summary = result?.user_summary || {}
  const findings = Array.isArray(summary?.findings) ? summary.findings : []
  const confidence =
    findings.length > 0
      ? Math.round(
          findings.reduce((total: number, finding: JsonRecord) => {
            return total + normalizeConfidence(finding?.confidence)
          }, 0) / findings.length,
        )
      : 50

  return {
    text: String(item?.claim?.text || summary?.claim || 'Alegação analisada'),
    verdict: verdictFromStatus(summary?.status || result?.article_assessment?.status),
    confidence,
    note: String(
      summary?.summary ||
        summary?.interpretation ||
        result?.article_assessment?.explanation ||
        'A análise foi concluída, mas não retornou um resumo textual.',
    ),
  }
}

function uniqueLinks(items: { label: string; url: string }[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

function hostnameOrValue(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return 'Fonte científica'
  try {
    return new URL(text).hostname.replace(/^www\./, '')
  } catch {
    return text
  }
}

function mapResult(job: JsonRecord, submittedReference?: string): ApiAnalysisResult {
  const result = job?.result || {}
  const submitted = result?.submitted_article || {}
  const claimAnalyses = Array.isArray(result?.claim_analyses) ? result.claim_analyses : []
  const claims = claimAnalyses.map(claimFromAnalysis)

  if (claims.length === 0 && result?.user_summary) {
    claims.push(
      claimFromAnalysis({
        claim: { text: result.user_summary.claim || submitted.primary_claim },
        result,
      }),
    )
  }

  const allFindings = claimAnalyses.flatMap((item: JsonRecord) => {
    const findings = item?.result?.user_summary?.findings
    return Array.isArray(findings) ? findings : []
  })

  const allCaveats = claimAnalyses.flatMap((item: JsonRecord) => {
    const caveats = item?.result?.user_summary?.caveats
    return Array.isArray(caveats) ? caveats : []
  })

  const alerts = claimAnalyses.flatMap((item: JsonRecord) => {
    const values = item?.result?.verification?.alerts
    return Array.isArray(values) ? values : []
  })

  const redFlags = Array.from(
    new Set([
      ...alerts.map((alert: JsonRecord) =>
        String(alert?.title || alert?.detail || '').trim(),
      ),
      ...allCaveats.map((item: unknown) => String(item || '').trim()),
    ].filter(Boolean)),
  ).slice(0, 8)

  const supportingLinks = uniqueLinks(
    allFindings
      .map((finding: JsonRecord) => ({
        label: String(
          finding?.article_title_pt ||
            finding?.article_title ||
            finding?.journal ||
            'Evidência científica',
        ),
        url: String(finding?.source_url || ''),
      }))
      .filter((item) => item.url),
  ).slice(0, 8)

  const verdicts = claims.map((claim) => claim.verdict)
  let overallVerdict: ApiVerdict = 'uncertain'
  if (verdicts.length > 0 && verdicts.every((value) => value === 'verified')) {
    overallVerdict = 'verified'
  } else if (verdicts.some((value) => value === 'fake') && !verdicts.includes('verified')) {
    overallVerdict = 'fake'
  }

  const credibilityScore =
    claims.length > 0
      ? Math.round(claims.reduce((total, claim) => total + claim.confidence, 0) / claims.length)
      : 50

  const publicationDate =
    allFindings.find((finding: JsonRecord) => finding?.publication_date)?.publication_date ||
    result?.article_dossier?.bibliographic?.publication_date ||
    'Data não informada'

  const articleUrl =
    submittedReference && /^https?:\/\//i.test(submittedReference)
      ? submittedReference
      : undefined

  return {
    title: String(submitted?.title || 'Artigo científico analisado'),
    source: hostnameOrValue(submitted?.source || submittedReference),
    publishedDate: String(publicationDate),
    overallVerdict,
    credibilityScore,
    claims,
    redFlags,
    supportingLinks,
    analysisId: String(job?.analysis_id || 'sem-id'),
    articleUrl,
  }
}

async function pollAnalysis(statusUrl: string, submittedReference?: string): Promise<ApiAnalysisResult> {
  const deadline = Date.now() + 10 * 60 * 1000
  let claimSelectionSubmitted = false

  while (Date.now() < deadline) {
    const statusJob = await requestJson(
      `${statusUrl}${statusUrl.includes('?') ? '&' : '?'}view=status`,
    )
    const status = String(statusJob?.status || '').toUpperCase()

    if (status === 'FAILED') {
      throw new Error(
        statusJob?.error?.message || 'O backend não conseguiu concluir a análise.',
      )
    }

    if (status === 'AWAITING_CLAIM_SELECTION' && !claimSelectionSubmitted) {
      const fullJob = await requestJson(statusUrl)
      const claims = fullJob?.result?.submitted_article?.claims
      if (!Array.isArray(claims) || claims.length === 0) {
        throw new Error('O backend não retornou alegações para análise.')
      }

      await requestJson(
        `/api/v1/article-analyses/${encodeURIComponent(fullJob.analysis_id)}/claims`,
        {
          method: 'POST',
          body: JSON.stringify({
            claims: claims.slice(0, 10).map((claim: JsonRecord) => ({
              claim_id: claim.claim_id,
              text: claim.text,
            })),
            depth: 'QUICK',
          }),
        },
      )
      claimSelectionSubmitted = true
      await delay(750)
      continue
    }

    if (status === 'SUCCEEDED') {
      const fullJob = await requestJson(statusUrl)
      return mapResult(fullJob, submittedReference)
    }

    await delay(1200)
  }

  throw new Error('A análise excedeu o tempo limite de 10 minutos.')
}

export async function analyzeArticle(input: {
  articleReference?: string
  file?: File
}): Promise<ApiAnalysisResult> {
  const hasReference = Boolean(input.articleReference?.trim())
  const hasFile = Boolean(input.file)
  if (hasReference === hasFile) {
    throw new Error('Informe um PMID/DOI/link do PubMed ou envie um PDF/imagem.')
  }

  let payload: JsonRecord
  if (input.file) {
    if (!isSupportedArticleFile(input.file)) {
      throw new Error('Envie PDF, PNG, JPG ou WebP com até 25 MB.')
    }
    payload = {
      article_file: {
        name: input.file.name,
        mime_type: input.file.type,
        data_base64: await fileToBase64(input.file),
      },
    }
  } else {
    payload = { article_reference: input.articleReference!.trim() }
  }

  const created = await requestJson('/api/v1/article-analyses', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  const statusUrl = String(created?.status_url || '')
  if (!statusUrl) {
    throw new Error('O backend não retornou o endereço de acompanhamento da análise.')
  }

  return pollAnalysis(statusUrl, input.articleReference?.trim())
}
