export type AnalysisJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RESEARCHING'
  | 'AWAITING_CLAIM_SELECTION'
  | 'SUCCEEDED'
  | 'FAILED'

export interface BackendClaim {
  claim_id: string
  text: string
  quote?: string | null
  section?: string | null
  page?: number | null
  profile?: {
    importance?: 'HIGH' | 'MEDIUM' | 'LOW'
    claim_type?: string
  } | null
}

export interface AnalysisJob {
  analysis_id: string
  status: AnalysisJobStatus
  progress: number
  status_url?: string
  claim_selection_url?: string
  result?: any
  error?: {
    code?: string
    message?: string
  }
}

export type AnalysisProgressCallback = (
  status: AnalysisJobStatus,
  progress: number,
) => void

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      data?.error?.message ??
      data?.message ??
      `Erro HTTP ${response.status} ao comunicar com o backend.`
    throw new Error(message)
  }

  return data as T
}

export async function createArticleAnalysis(
  payload:
    | { article_reference: string }
    | {
        article_file: {
          name: string
          mime_type: string
          data_base64: string
        }
      },
): Promise<AnalysisJob> {
  const response = await fetch(apiUrl('/api/v1/article-analyses'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return parseResponse<AnalysisJob>(response)
}

export async function getAnalysisStatus(analysisId: string): Promise<AnalysisJob> {
  const response = await fetch(
    apiUrl(`/api/v1/analyses/${encodeURIComponent(analysisId)}?view=status`),
    { headers: { Accept: 'application/json' } },
  )

  return parseResponse<AnalysisJob>(response)
}

export async function getAnalysis(analysisId: string): Promise<AnalysisJob> {
  const response = await fetch(
    apiUrl(`/api/v1/analyses/${encodeURIComponent(analysisId)}`),
    { headers: { Accept: 'application/json' } },
  )

  return parseResponse<AnalysisJob>(response)
}

export async function selectClaims(
  analysisId: string,
  claims: BackendClaim[],
  depth: 'QUICK' | 'DEEP' = 'QUICK',
): Promise<AnalysisJob> {
  const response = await fetch(
    apiUrl(`/api/v1/article-analyses/${encodeURIComponent(analysisId)}/claims`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claims: claims.map((claim) => ({
          claim_id: claim.claim_id,
          text: claim.text,
        })),
        depth,
      }),
    },
  )

  return parseResponse<AnalysisJob>(response)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function waitForAnalysis(
  analysisId: string,
  onProgress?: AnalysisProgressCallback,
): Promise<AnalysisJob> {
  const maxPolls = 400

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const job = await getAnalysisStatus(analysisId)
    onProgress?.(job.status, job.progress ?? 0)

    if (job.status === 'FAILED') {
      throw new Error(job.error?.message || 'A análise científica falhou.')
    }

    if (
      job.status === 'AWAITING_CLAIM_SELECTION' ||
      job.status === 'SUCCEEDED'
    ) {
      return getAnalysis(analysisId)
    }

    await sleep(1500)
  }

  throw new Error('A análise excedeu o tempo de acompanhamento do frontend.')
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Não foi possível ler o arquivo.'))
        return
      }

      const base64 = reader.result.split(',')[1]
      if (!base64) {
        reject(new Error('O arquivo selecionado é inválido.'))
        return
      }

      resolve(base64)
    }

    reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}

export async function analyzeArticle(
  input:
    | { articleReference: string }
    | { file: File },
  onProgress?: AnalysisProgressCallback,
): Promise<AnalysisJob> {
  let created: AnalysisJob

  if ('articleReference' in input) {
    created = await createArticleAnalysis({
      article_reference: input.articleReference.trim(),
    })
  } else {
    const allowedTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ])

    if (!allowedTypes.has(input.file.type)) {
      throw new Error('Envie um PDF, PNG, JPEG ou WebP válido.')
    }

    if (input.file.size > 25 * 1024 * 1024) {
      throw new Error('O arquivo deve ter no máximo 25 MB.')
    }

    created = await createArticleAnalysis({
      article_file: {
        name: input.file.name,
        mime_type: input.file.type,
        data_base64: await fileToBase64(input.file),
      },
    })
  }

  onProgress?.(created.status, created.progress ?? 0)

  let job = await waitForAnalysis(created.analysis_id, onProgress)

  if (job.status === 'AWAITING_CLAIM_SELECTION') {
    const claims = (job.result?.submitted_article?.claims ?? []) as BackendClaim[]

    if (!claims.length) {
      throw new Error('Nenhuma alegação científica foi identificada no artigo.')
    }

    await selectClaims(created.analysis_id, claims, 'QUICK')
    job = await waitForAnalysis(created.analysis_id, onProgress)
  }

  if (job.status !== 'SUCCEEDED') {
    throw new Error('A análise não foi concluída pelo backend.')
  }

  return job
}
