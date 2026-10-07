import { useState, useRef, useCallback } from 'react'
import { analyzeArticle, isSupportedArticleFile } from './api'

type VerifyMode = 'url' | 'image'
type AnalysisStatus = 'idle' | 'loading' | 'done' | 'error'
type Verdict = 'verified' | 'fake' | 'uncertain'

interface Claim {
  text: string
  verdict: Verdict
  confidence: number
  note: string
}

interface AnalysisResult {
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

const HEALTH_AREAS: Record<string, { color: string; bg: string }> = {
  'Neurologia':    { color: '#4d9fff', bg: '#4d9fff18' },
  'Cardiologia':   { color: '#f04060', bg: '#f0406018' },
  'Nutrição':      { color: '#00d4aa', bg: '#00d4aa18' },
  'Oncologia':     { color: '#a78bfa', bg: '#a78bfa18' },
  'Saúde Mental':  { color: '#f5a623', bg: '#f5a62318' },
  'Infectologia':  { color: '#fb923c', bg: '#fb923c18' },
  'Genética':      { color: '#34d399', bg: '#34d39918' },
  'Geral':         { color: '#6b7fa3', bg: '#6b7fa318' },
}

function detectHealthArea(title: string): string {
  const t = title.toLowerCase()
  if (/alzheimer|neuro|cerebr|cogni|memória|demência/.test(t)) return 'Neurologia'
  if (/cardio|coração|pressão|infarto|colesterol/.test(t)) return 'Cardiologia'
  if (/câncer|tumor|oncol|quimio/.test(t)) return 'Oncologia'
  if (/café|vitamina|nutri|dieta|aliment|proteína/.test(t)) return 'Nutrição'
  if (/ansied|depressão|mental|psico|estresse/.test(t)) return 'Saúde Mental'
  if (/vírus|bactéria|infecção|vacina|covid|gripe/.test(t)) return 'Infectologia'
  if (/genética|dna|rna|genoma|cromossomo/.test(t)) return 'Genética'
  return 'Geral'
}

const MOCK_RESULT: AnalysisResult = {
  title: 'Novo estudo afirma que café reduz risco de Alzheimer em 65%',
  source: 'sciencedaily.com',
  publishedDate: '14 set. 2026',
  overallVerdict: 'uncertain',
  credibilityScore: 47,
  analysisId: 'SCI-2026-09140831',
  claims: [
    {
      text: 'Consumo diário de 3 xícaras de café associado à menor incidência de Alzheimer',
      verdict: 'verified',
      confidence: 82,
      note: 'Confirmado em meta-análise de 2024 com 14.000 participantes (JAMA Neurology).',
    },
    {
      text: 'Redução de 65% no risco absoluto de desenvolver a doença',
      verdict: 'fake',
      confidence: 91,
      note: 'Número reflete risco relativo em subgrupo, não risco absoluto. Distorção estatística.',
    },
    {
      text: 'Resultado replicado em múltiplos ensaios clínicos controlados',
      verdict: 'uncertain',
      confidence: 55,
      note: 'Apenas estudos observacionais. Nenhum ensaio clínico randomizado sobre este efeito.',
    },
    {
      text: 'Cafeína age como protetor da barreira hematoencefálica',
      verdict: 'verified',
      confidence: 78,
      note: 'Mecanismo descrito em estudos pré-clínicos com modelos murinos (Nature, 2023).',
    },
  ],
  redFlags: [
    'Título usa linguagem absoluta ("reduz") sem citar margem de erro',
    'Percentual de 65% não consta na pesquisa original referenciada',
    'Fonte primária é press release, não o artigo revisado por pares',
  ],
  supportingLinks: [
    {
      label: 'JAMA Neurology — Coffee and Dementia Risk',
      url: 'https://jamanetwork.com/journals/jamaneurology/search/results?q=coffee+dementia+risk',
    },
    {
      label: 'Nature — Caffeine and BBB Permeability',
      url: 'https://www.nature.com/search?q=caffeine+blood+brain+barrier+permeability',
    },
    {
      label: 'PubMed — Meta-análise café e Alzheimer 2024',
      url: 'https://pubmed.ncbi.nlm.nih.gov/?term=coffee+alzheimer+meta-analysis&filter=years.2020-2024',
    },
  ],
}

function VerdictBadge({ verdict, size = 'sm' }: { verdict: Verdict; size?: 'sm' | 'lg' }) {
  const map = {
    verified: { label: 'COMPATÍVEL', color: 'text-[--color-teal] border-[--color-teal] bg-[--color-teal-faint]' },
    fake: { label: 'DIVERGENTE', color: 'text-[--color-red] border-[--color-red] bg-[--color-red-faint]' },
    uncertain: { label: 'INCONCLUSIVO', color: 'text-[--color-amber] border-[--color-amber] bg-[--color-amber-faint]' },
  }
  const { label, color } = map[verdict]
  const px = size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
  return (
    <span className={`font-mono font-semibold border rounded ${px} ${color} tracking-widest`}>
      {label}
    </span>
  )
}

function ConfidenceBar({ value, verdict }: { value: number; verdict: Verdict }) {
  const colorMap = {
    verified: '#00d4aa',
    fake: '#f04060',
    uncertain: '#f5a623',
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, background: colorMap[verdict] }}
        />
      </div>
      <span className="font-mono text-[10px] text-[--color-muted] w-8 text-right">{value}%</span>
    </div>
  )
}

function ScoreRing({ score, verdict }: { score: number; verdict: Verdict }) {
  const colorMap = { verified: '#00d4aa', fake: '#f04060', uncertain: '#f5a623' }
  const color = colorMap[verdict]
  const r = 44
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  return (
    <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
      <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-mono font-semibold text-2xl" style={{ color }}>{score}</div>
        <div className="font-mono text-[9px] text-[--color-muted] tracking-widest mt-0.5">CONFIANÇA</div>
      </div>
    </div>
  )
}

function AnalysisCard({ result }: { result: AnalysisResult }) {
  const verdictLabel = { verified: 'Compatível com as evidências', fake: 'Possível divergência', uncertain: 'Evidência inconclusiva ou mista' }

  return (
    <div className="animate-slide-up mt-10 space-y-4">
      {/* Header */}
      <div className="border border-[--color-border] rounded-lg p-5 bg-[--color-surface] space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-[10px] text-[--color-muted] tracking-widest">
                #{result.analysisId}
              </span>
              <span className="w-1 h-1 rounded-full bg-[--color-subtle]" />
              <span className="font-mono text-[10px] text-[--color-muted]">{result.publishedDate}</span>
            </div>
            <h2 className="text-base font-semibold text-[--color-foreground] leading-snug">{result.title}</h2>
            <p className="text-xs text-[--color-muted] mt-1">{result.source}</p>
          </div>
          <ScoreRing score={result.credibilityScore} verdict={result.overallVerdict} />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[--color-border] flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <VerdictBadge verdict={result.overallVerdict} size="lg" />
            <span className="text-sm text-[--color-muted]">{verdictLabel[result.overallVerdict]}</span>
          </div>
          {result.articleUrl && (
            <a
              href={result.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-1.5 rounded-md border border-[--color-border] text-xs font-medium text-[--color-foreground] transition-all duration-150 hover:bg-white hover:text-black hover:border-white"
              style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 2h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Ver artigo original
            </a>
          )}
        </div>
      </div>

      {/* Claims */}
      <div className="border border-[--color-border] rounded-lg bg-[--color-surface] overflow-hidden">
        <div className="px-5 py-3 border-b border-[--color-border] flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[--color-blue]" />
          <span className="font-mono text-[11px] text-[--color-muted] tracking-widest uppercase">
            Análise de Afirmações
          </span>
        </div>
        <div className="divide-y divide-[--color-border]">
          {result.claims.map((claim, i) => (
            <div key={i} className="px-5 py-4 space-y-2">
              <div className="flex items-start gap-3">
                <VerdictBadge verdict={claim.verdict} />
                <p className="text-sm text-[--color-foreground] leading-snug flex-1">{claim.text}</p>
              </div>
              <ConfidenceBar value={claim.confidence} verdict={claim.verdict} />
              <p className="text-xs text-[--color-muted] leading-relaxed">{claim.note}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Red flags */}
      <div className="border border-[--color-red] border-opacity-30 rounded-lg bg-[--color-red-faint] p-5 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[--color-red]" />
          <span className="font-mono text-[11px] text-[--color-red] tracking-widest uppercase">
            Alertas Detectados
          </span>
        </div>
        {result.redFlags.map((flag, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="font-mono text-[--color-red] text-xs mt-0.5">!</span>
            <p className="text-sm text-[--color-foreground] opacity-90">{flag}</p>
          </div>
        ))}
      </div>

      {/* Sources */}
      <div className="border border-[--color-border] rounded-lg bg-[--color-surface] p-5 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[--color-teal]" />
          <span className="font-mono text-[11px] text-[--color-muted] tracking-widest uppercase">
            Fontes Consultadas
          </span>
        </div>
        {result.supportingLinks.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-[--color-border] text-sm text-[--color-blue] transition-all duration-150 group hover:border-[--color-teal] hover:bg-[--color-teal-faint] hover:text-[--color-teal]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[--color-subtle] group-hover:text-[--color-teal] text-xs shrink-0">→</span>
              <span className="truncate">{link.label}</span>
            </div>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true" className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
              <path d="M1 1h9v9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── LGPD Terms content (shared between modal and footer) ─────
const LGPD_SECTIONS = [
  {
    title: '1. Identificação do Controlador',
    text: 'A plataforma ArtFact, doravante denominada "Controlador", é responsável pelo tratamento dos dados pessoais coletados neste site, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD).',
  },
  {
    title: '2. Dados Coletados',
    text: 'Coletamos os seguintes dados pessoais: (a) nome completo; (b) endereço de e-mail; (c) dados de acesso fornecidos via autenticação Google (nome e e-mail públicos); (d) histórico de artigos verificados associado à conta do usuário. Não coletamos dados sensíveis conforme definido no art. 11 da LGPD.',
  },
  {
    title: '3. Finalidade do Tratamento',
    text: 'Os dados são tratados exclusivamente para: (a) criar e gerenciar a conta do usuário; (b) salvar e recuperar artigos verificados; (c) melhorar a experiência da plataforma; (d) cumprir obrigações legais aplicáveis. O tratamento é fundamentado no consentimento do titular (art. 7º, I, LGPD) e no legítimo interesse do Controlador (art. 7º, IX, LGPD).',
  },
  {
    title: '4. Compartilhamento de Dados',
    text: 'Não comercializamos, alugamos ou compartilhamos dados pessoais com terceiros para fins comerciais. Poderemos compartilhar dados com prestadores de serviços de infraestrutura (ex.: provedores de nuvem) estritamente para operação da plataforma, sob acordo de confidencialidade e com as mesmas garantias desta Política.',
  },
  {
    title: '5. Retenção de Dados',
    text: 'Os dados são mantidos enquanto a conta estiver ativa. Após a exclusão da conta, os dados pessoais serão removidos em até 30 (trinta) dias, salvo obrigação legal de retenção por prazo superior.',
  },
  {
    title: '6. Direitos do Titular',
    text: 'Nos termos dos arts. 17 a 22 da LGPD, o titular tem direito a: (a) confirmação da existência de tratamento; (b) acesso aos dados; (c) correção de dados incompletos, inexatos ou desatualizados; (d) anonimização, bloqueio ou eliminação de dados desnecessários; (e) portabilidade dos dados; (f) eliminação dos dados tratados com consentimento; (g) informação sobre compartilhamentos; (h) revogação do consentimento a qualquer momento.',
  },
  {
    title: '7. Segurança',
    text: 'Adotamos medidas técnicas e administrativas adequadas para proteger os dados pessoais contra acessos não autorizados, destruição, perda, alteração ou comunicação indevida, em conformidade com o art. 46 da LGPD.',
  },
  {
    title: '8. Encarregado (DPO)',
    text: 'Para exercer seus direitos ou esclarecer dúvidas sobre o tratamento de dados, entre em contato com nosso Encarregado de Proteção de Dados pelo e-mail: privacidade@artfact.com.br. Responderemos em até 15 (quinze) dias úteis.',
  },
  {
    title: '9. Alterações desta Política',
    text: 'Esta Política pode ser atualizada periodicamente. Alterações relevantes serão comunicadas por e-mail ou notificação na plataforma. A data da última atualização consta no rodapé deste documento.',
  },
]

// ── Terms Modal ───────────────────────────────────────────────
function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,12,24,0.88)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-xl border bg-[--color-surface] relative animate-slide-up flex flex-col"
        style={{ borderColor: '#00d4aa', maxHeight: 'calc(100vh - 3rem)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[--color-border] shrink-0">
          <div className="space-y-0.5">
            <span className="font-mono text-[10px] text-[--color-teal] tracking-widest uppercase">ArtFact</span>
            <h2 className="text-sm font-semibold text-[--color-foreground]">Política de Privacidade e Proteção de Dados</h2>
            <p className="font-mono text-[10px] text-[--color-muted]">Atualizado em 30 set. 2026 · Conforme LGPD (Lei 13.709/2018)</p>
          </div>
          <button onClick={onClose} className="text-[--color-muted] hover:text-white transition-colors text-lg leading-none ml-4 shrink-0" aria-label="Fechar">✕</button>
        </div>
        {/* Scrollable content */}
        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {LGPD_SECTIONS.map((s) => (
            <div key={s.title} className="space-y-1.5">
              <h3 className="font-mono text-[11px] text-[--color-teal] tracking-widest uppercase">{s.title}</h3>
              <p className="text-xs text-[--color-muted] leading-relaxed" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>{s.text}</p>
            </div>
          ))}
          <div className="pt-2 border-t border-[--color-border]">
            <p className="font-mono text-[10px] text-[--color-subtle] text-center">
              ArtFact — Verificação científica independente · privacidade@artfact.com.br
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Login Modal ──────────────────────────────────────────────
function LoginModal({
  onClose,
  onLogin,
  onOpenTerms,
}: {
  onClose: () => void
  onLogin: (name: string) => void
  onOpenTerms: () => void
}) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || (tab === 'register' && !name)) {
      setError('Preencha todos os campos.')
      return
    }
    if (tab === 'register' && !agreed) {
      setError('Você precisa aceitar os Termos e a Política de Privacidade.')
      return
    }
    onLogin(tab === 'register' ? name : email.split('@')[0])
  }

  const handleGoogle = () => {
    onLogin('Usuário Google')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,12,24,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-[--color-surface] p-7 space-y-5 relative animate-slide-up"
        style={{ borderColor: '#00d4aa' }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-[--color-muted] hover:text-white transition-colors text-lg leading-none" aria-label="Fechar">✕</button>

        {/* Logo */}
        <svg height="26" viewBox="0 0 142 76" fill="none" style={{ width: 'auto' }} aria-hidden="true">
          <circle cx="36" cy="36" r="28" stroke="#00d4aa" strokeWidth="6"/>
          <line x1="57" y1="57" x2="75" y2="75" stroke="#00d4aa" strokeWidth="6" strokeLinecap="round"/>
          <text x="36" y="42" textAnchor="middle" fontFamily="Instrument Sans, sans-serif" fontWeight="700" fontSize="15" fill="#00d4aa" letterSpacing="1">ART</text>
          <text x="72" y="48" fontFamily="Instrument Sans, sans-serif" fontWeight="700" fontSize="27" fill="#dce6f5">Fact</text>
        </svg>

        {/* Google button */}
        <button
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg border border-[--color-border] text-sm text-[--color-foreground] transition-all duration-150 hover:bg-white hover:text-black hover:border-white"
          style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.3 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.5 13 17.8 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17z"/>
            <path fill="#FBBC05" d="M10.5 28.6A14.8 14.8 0 019.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A23.8 23.8 0 000 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/>
            <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.5-5.8c-2.1 1.4-4.8 2.2-8 2.2-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/>
          </svg>
          Continuar com Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[--color-border]" />
          <span className="font-mono text-[10px] text-[--color-subtle] tracking-widest">OU</span>
          <div className="flex-1 h-px bg-[--color-border]" />
        </div>

        {/* Tabs */}
        <div className="flex border border-[--color-border] rounded-lg overflow-hidden">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2 text-xs font-mono tracking-widest uppercase transition-colors duration-150 ${
                tab === t ? 'bg-[--color-teal] text-[--color-background]' : 'text-[--color-muted] hover:bg-white hover:text-black'
              }`}
            >
              {t === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {tab === 'register' && (
            <div className="space-y-1">
              <label className="font-mono text-[10px] text-[--color-muted] tracking-widest uppercase">Nome</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome"
                className="w-full bg-[--color-background] border border-[--color-border] rounded-lg px-4 py-2.5 text-sm text-[--color-foreground] placeholder:text-[--color-subtle] outline-none focus:border-[--color-teal] transition-colors" />
            </div>
          )}
          <div className="space-y-1">
            <label className="font-mono text-[10px] text-[--color-muted] tracking-widest uppercase">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com"
              className="w-full bg-[--color-background] border border-[--color-border] rounded-lg px-4 py-2.5 text-sm text-[--color-foreground] placeholder:text-[--color-subtle] outline-none focus:border-[--color-teal] transition-colors" />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[10px] text-[--color-muted] tracking-widest uppercase">Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full bg-[--color-background] border border-[--color-border] rounded-lg px-4 py-2.5 text-sm text-[--color-foreground] placeholder:text-[--color-subtle] outline-none focus:border-[--color-teal] transition-colors" />
          </div>

          {/* Terms checkbox — only on register */}
          {tab === 'register' && (
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className="w-4 h-4 rounded border transition-colors duration-150 flex items-center justify-center"
                  style={{
                    borderColor: agreed ? '#00d4aa' : '#2a3a60',
                    background: agreed ? '#00d4aa' : 'transparent',
                  }}
                >
                  {agreed && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                      <path d="M1 4l3 3 5-6" stroke="#080c18" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs text-[--color-muted] leading-relaxed" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
                Li e concordo com a{' '}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onOpenTerms() }}
                  className="text-[--color-teal] underline underline-offset-2 hover:text-white transition-colors"
                >
                  Política de Privacidade
                </button>
                {' '}e os Termos de Uso da ArtFact, em conformidade com a LGPD.
              </span>
            </label>
          )}

          {error && <p className="text-xs text-[--color-red] font-mono">{error}</p>}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 bg-[--color-teal] text-[--color-background] hover:bg-white hover:text-black"
            style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
          >
            {tab === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Login Banner ──────────────────────────────────────────────
function LoginBanner({ onLogin, onDismiss }: { onLogin: () => void; onDismiss: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border animate-slide-up flex-wrap"
      style={{ borderColor: '#f5a623', background: '#f5a62310' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-[--color-amber] text-base">⚠</span>
        <p className="text-xs text-[--color-foreground]" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
          <span className="font-semibold">Você não está logado.</span> Este artigo será perdido ao sair da página.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onLogin}
          className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[--color-teal] text-[--color-background] hover:bg-white hover:text-black transition-all duration-150"
          style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
        >
          Fazer login
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-md text-xs text-[--color-muted] hover:text-white transition-colors"
          aria-label="Dispensar"
        >✕</button>
      </div>
    </div>
  )
}

// ── Saved Articles Panel ──────────────────────────────────────
function SavedPanel({ articles, onClose }: { articles: AnalysisResult[]; onClose: () => void }) {
  const [activeArea, setActiveArea] = useState<string>('Todas')
  const verdictColor = { verified: '#00d4aa', fake: '#f04060', uncertain: '#f5a623' }
  const verdictLabel = { verified: 'Verificado', fake: 'Falso', uncertain: 'Incerto' }

  const areas = ['Todas', ...Array.from(new Set(articles.map((a) => a.healthArea ?? 'Geral')))]
  const filtered = activeArea === 'Todas' ? articles : articles.filter((a) => (a.healthArea ?? 'Geral') === activeArea)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-4"
      style={{ background: 'rgba(8,12,24,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-xs rounded-xl border bg-[--color-surface] flex flex-col animate-slide-up"
        style={{ borderColor: '#00d4aa', maxHeight: 'calc(100vh - 2rem)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[--color-border] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-teal]" />
            <span className="font-mono text-[11px] text-[--color-muted] tracking-widest uppercase">Artigos Salvos</span>
            {articles.length > 0 && (
              <span className="font-mono text-[10px] text-[--color-teal] border border-[--color-teal] rounded px-1">{articles.length}</span>
            )}
          </div>
          <button onClick={onClose} className="text-[--color-muted] hover:text-white transition-colors text-sm">✕</button>
        </div>

        {/* Area filters */}
        {articles.length > 0 && (
          <div className="px-4 py-3 border-b border-[--color-border] shrink-0">
            <p className="font-mono text-[9px] text-[--color-subtle] tracking-widest uppercase mb-2">Área de saúde</p>
            <div className="flex flex-wrap gap-1.5">
              {areas.map((area) => {
                const cfg = area === 'Todas' ? null : HEALTH_AREAS[area]
                const isActive = activeArea === area
                return (
                  <button
                    key={area}
                    onClick={() => setActiveArea(area)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-mono tracking-wide transition-all duration-150"
                    style={{
                      border: `1px solid ${isActive ? (cfg?.color ?? '#00d4aa') : 'var(--color-border)'}`,
                      background: isActive ? (cfg?.bg ?? '#00d4aa18') : 'transparent',
                      color: isActive ? (cfg?.color ?? '#00d4aa') : 'var(--color-muted)',
                    }}
                  >
                    {area}
                    {area !== 'Todas' && (
                      <span className="ml-1 opacity-70">
                        {articles.filter((a) => (a.healthArea ?? 'Geral') === area).length}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Articles list */}
        <div className="flex-1 overflow-y-auto divide-y divide-[--color-border]">
          {articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3">
              <span className="font-mono text-3xl text-[--color-subtle]">⊡</span>
              <p className="text-xs text-[--color-muted] text-center font-mono">Nenhum artigo salvo ainda.</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-[--color-muted] text-center py-10 font-mono">Sem artigos nesta área.</p>
          ) : filtered.map((a, i) => {
            const area = a.healthArea ?? 'Geral'
            const cfg = HEALTH_AREAS[area] ?? HEALTH_AREAS['Geral']
            return (
            <div key={i} className="px-5 py-4 space-y-2">
              {/* Area tag + verdict */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-mono text-[9px] tracking-widest uppercase rounded-full px-2 py-0.5"
                  style={{ color: cfg.color, background: cfg.bg }}
                >
                  {area}
                </span>
                <span
                  className="font-mono text-[9px] tracking-widest uppercase border rounded px-1.5 py-0.5"
                  style={{ color: verdictColor[a.overallVerdict], borderColor: verdictColor[a.overallVerdict] }}
                >
                  {verdictLabel[a.overallVerdict]}
                </span>
                <span className="font-mono text-[9px] text-[--color-subtle] ml-auto">Score {a.credibilityScore}</span>
              </div>
              <p className="text-xs text-[--color-foreground] leading-snug line-clamp-2">{a.title}</p>
              <p className="font-mono text-[10px] text-[--color-muted]">{a.source}</p>
            </div>
          )})}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState<VerifyMode>('url')
  const [url, setUrl] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userName, setUserName] = useState('')
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [showTermsModal, setShowTermsModal] = useState(false)
  const [savedArticles, setSavedArticles] = useState<AnalysisResult[]>([])

  const handleLogin = (name: string) => {
    setIsLoggedIn(true)
    setUserName(name)
    setShowLoginModal(false)
    setShowBanner(false)
    if (result) setSavedArticles((prev) => [...prev, result])
  }

  const handleAnalyze = async () => {
    if (mode === 'url' && !url.trim()) return
    if (mode === 'image' && !uploadedFile) return

    setStatus('loading')
    setResult(null)
    setErrorMessage('')
    setShowBanner(false)

    try {
      const apiResult = await analyzeArticle({
        articleReference: mode === 'url' ? url.trim() : undefined,
        file: mode === 'image' ? uploadedFile ?? undefined : undefined,
      })
      const r: AnalysisResult = {
        ...apiResult,
        healthArea: detectHealthArea(apiResult.title),
      }
      setStatus('done')
      setResult(r)
      if (!isLoggedIn) setShowBanner(true)
      else setSavedArticles((prev) => [...prev, r])
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir a análise. Verifique se o backend está rodando.',
      )
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && isSupportedArticleFile(file)) {
      setUploadedFile(file)
      setErrorMessage('')
    } else if (file) {
      setStatus('error')
      setErrorMessage('Envie PDF, PNG, JPG ou WebP com até 25 MB.')
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!isSupportedArticleFile(file)) {
      setUploadedFile(null)
      setStatus('error')
      setErrorMessage('Envie PDF, PNG, JPG ou WebP com até 25 MB.')
      return
    }
    setUploadedFile(file)
    setErrorMessage('')
    setStatus('idle')
  }

  const canAnalyze = mode === 'url' ? url.trim().length > 0 : uploadedFile !== null

  return (
    <div className="min-h-screen bg-[--color-background] grid-bg scan-line">
      {/* Nav */}
      <header className="border-b border-[--color-border] bg-[--color-background] bg-opacity-90 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* ArtFact wordmark logo */}
          <div className="logo-mark cursor-pointer" style={{ lineHeight: 0 }}>
              <svg
                height="42"
                viewBox="0 0 142 76"
                fill="none"
                aria-label="ArtFact"
                style={{ width: 'auto' }}
              >
                {/* Magnifying glass — animates on hover */}
                <g className="logo-glass">
                  {/* Outer ring */}
                  <circle cx="36" cy="36" r="28" stroke="#00d4aa" strokeWidth="6"/>
                  {/* Handle */}
                  <line x1="57" y1="57" x2="75" y2="75" stroke="#00d4aa" strokeWidth="6" strokeLinecap="round"/>
                </g>
                {/* ART inside lens */}
                <text
                  x="36" y="42"
                  textAnchor="middle"
                  fontFamily="Instrument Sans, sans-serif"
                  fontWeight="700"
                  fontSize="15"
                  fill="#00d4aa"
                  className="logo-art"
                  letterSpacing="1"
                >
                  ART
                </text>
                {/* Fact outside lens */}
                <text
                  x="72" y="48"
                  fontFamily="Instrument Sans, sans-serif"
                  fontWeight="700"
                  fontSize="27"
                  fill="#dce6f5"
                  className="logo-fact"
                >
                  Fact
                </text>
              </svg>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <a href="#como" className="text-xs text-[--color-muted] px-3 py-1.5 rounded-md transition-all duration-150 hover:bg-white hover:text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>Como funciona</a>
            <a href="#sobre" className="text-xs text-[--color-muted] px-3 py-1.5 rounded-md transition-all duration-150 hover:bg-white hover:text-black" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>Sobre</a>
            {isLoggedIn ? (
              <div className="flex items-center gap-2 ml-2">
                <button
                  onClick={() => setShowSaved(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[--color-border] text-xs text-[--color-muted] hover:border-[--color-teal] hover:text-[--color-teal] transition-all duration-150"
                  style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 1h8a1 1 0 011 1v9l-4.5-2.5L2 11V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                  {savedArticles.length > 0 && (
                    <span className="font-mono text-[10px] text-[--color-teal]">{savedArticles.length}</span>
                  )}
                  Salvos
                </button>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[--color-surface] border border-[--color-border]">
                  <div className="w-5 h-5 rounded-full bg-[--color-teal] flex items-center justify-center">
                    <span className="font-mono text-[9px] font-bold text-[--color-background]">
                      {userName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-xs text-[--color-foreground] max-w-[80px] truncate" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>{userName}</span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="ml-2 px-3 py-1.5 rounded-md text-xs font-semibold border border-[--color-teal] text-[--color-teal] hover:bg-[--color-teal] hover:text-[--color-background] transition-all duration-150"
                style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
              >
                Entrar
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-14 pb-24">
        {/* Hero */}
        <div className="mb-12 space-y-3">
          <div className="font-mono text-[11px] text-[--color-teal] tracking-widest uppercase mb-4">
            Verificador de artigos científicos 
          </div>
          <h1
            className="text-4xl leading-tight text-[--color-foreground]"
            style={{ fontFamily: "'Special Elite', cursive" }}
          >
            Busque por um artigo científico e <br />
            <span className="text-[--color-teal]">verifique a qualidade das evidências</span>
          </h1>
        </div>

        {/* Input card */}
        <div className="border border-[--color-border] rounded-xl bg-[--color-surface] overflow-hidden">
          {/* Mode toggle */}
          <div className="flex border-b border-[--color-border]">
            {(['url', 'image'] as VerifyMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setResult(null); setStatus('idle') }}
                className={`flex-1 py-3.5 font-mono text-xs tracking-widest uppercase transition-colors duration-150 ${
                  mode === m
                    ? 'text-[--color-teal] bg-[--color-teal-faint] border-b-2 border-[--color-teal]'
                    : 'text-[--color-muted] hover:text-[--color-foreground]'
                }`}
              >
                {m === 'url' ? '⌘  PMID / DOI / PubMed' : '⊡  PDF / Imagem'}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">
            {mode === 'url' ? (
              <div className="space-y-3">
                <label className="font-mono text-[10px] text-[--color-muted] tracking-widest uppercase">
                  PMID, DOI ou link do PubMed
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 flex items-center gap-3 bg-[--color-background] border border-[--color-border] rounded-lg px-4 focus-within:border-[--color-teal] transition-colors duration-150">
                    <span className="text-[--color-muted] text-sm select-none">https://</span>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && canAnalyze && handleAnalyze()}
                      placeholder="PMID, DOI ou https://pubmed.ncbi.nlm.nih.gov/..."
                      className="flex-1 bg-transparent text-sm text-[--color-foreground] placeholder:text-[--color-subtle] outline-none py-3 font-mono"
                    />
                  </div>
                </div>
                <p className="text-xs text-[--color-muted]">
                  O backend atual aceita PMID, DOI e links do PubMed/NCBI.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="font-mono text-[10px] text-[--color-muted] tracking-widest uppercase">
                  Arquivo do Artigo
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 ${
                    dragOver
                      ? 'border-[--color-teal] bg-[--color-teal-faint]'
                      : uploadedFile
                      ? 'border-[--color-teal] bg-[--color-teal-faint]'
                      : 'border-[--color-border] hover:border-[--color-border-bright] bg-[--color-background]'
                  }`}
                >
                  {uploadedFile ? (
                    <div className="space-y-1">
                      <div className="font-mono text-xs text-[--color-teal] tracking-wide">✓ Arquivo carregado</div>
                      <div className="text-sm text-[--color-foreground]">{uploadedFile.name}</div>
                      <div className="font-mono text-[10px] text-[--color-muted]">
                        {(uploadedFile.size / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-3xl text-[--color-subtle]">⊡</div>
                      <div className="text-sm text-[--color-muted]">
                        Arraste um PDF ou imagem aqui ou <span className="text-[--color-teal]">clique para selecionar</span>
                      </div>
                      <div className="font-mono text-[10px] text-[--color-subtle]">PDF, PNG, JPG, WEBP — máx. 25 MB</div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}

            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze || status === 'loading'}
              className={`w-full py-3.5 rounded-lg text-sm tracking-wide transition-all duration-150 ${
                canAnalyze && status !== 'loading'
                  ? 'bg-[--color-teal] text-[--color-background] hover:bg-white hover:text-black active:scale-[0.99]'
                  : 'bg-[--color-border] text-[--color-subtle] cursor-not-allowed'
              }`}
              style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 600 }}
            >
              {status === 'loading' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-[--color-background] border-t-transparent rounded-full animate-spin" />
                  Analisando...
                </span>
              ) : (
                'Verificar Agora'
              )}
            </button>
          </div>
        </div>

        {/* Loading skeleton */}
        {status === 'loading' && (
          <div className="mt-10 space-y-4 animate-slide-up">
            <div className="border border-[--color-border] rounded-lg p-5 bg-[--color-surface] space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-[--color-teal] animate-pulse" />
                <span className="font-mono text-[11px] text-[--color-teal] tracking-widest">VERIFICANDO FONTES...</span>
              </div>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="shimmer h-4 rounded w-full" style={{ width: `${70 + Math.random() * 30}%` }} />
              ))}
            </div>
          </div>
        )}

        {status === 'error' && errorMessage && (
          <div className="mt-6 border border-[--color-red] rounded-lg p-4 bg-[--color-red-faint] animate-slide-up">
            <div className="font-mono text-[10px] tracking-widest text-[--color-red] mb-1">ERRO NA ANÁLISE</div>
            <p className="text-sm text-[--color-foreground]">{errorMessage}</p>
            <p className="text-xs text-[--color-muted] mt-2">
              Confira se o backend FatoFake está rodando em http://127.0.0.1:5000.
            </p>
          </div>
        )}

        {/* Result */}
        {status === 'done' && result && <AnalysisCard result={result} />}

        {/* Login banner */}
        {showBanner && !isLoggedIn && status === 'done' && (
          <div className="mt-4">
            <LoginBanner
              onLogin={() => { setShowBanner(false); setShowLoginModal(true) }}
              onDismiss={() => setShowBanner(false)}
            />
          </div>
        )}

        {/* Sobre a Plataforma */}
        <section id="sobre" className="mt-16 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[--color-border]" />
        <span className="tracking-widest uppercase text-[26px]" style={{ fontFamily: '"Special Elite", cursive' }}>
          Sobre Nós
        </span>
            <div className="flex-1 h-px bg-[--color-border]" />
          </div>

          <div
            className="relative rounded-xl overflow-hidden border"
            style={{ borderColor: '#00d4aa', background: '#0f1526' }}
          >
            <div className="flex flex-col sm:flex-row min-h-[220px]">
              {/* Text side */}
              <div className="flex-1 flex flex-col justify-center gap-5 p-8 sm:pr-6 relative z-10">
                <div
                  className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r"
                  style={{ background: '#00d4aa' }}
                />
                <p
                  className="text-sm font-normal leading-relaxed"
                  style={{ color: '#ffffff', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  Verificamos a confiabilidade de artigos, notícias e afirmações científicas utilizando evidências provenientes de bases acadêmicas.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className="font-mono text-[10px] tracking-widest uppercase"
                    style={{ color: '#6b7fa3' }}
                  >
                    <span style={{ color: '#00d4aa' }}>●</span> EVIDÊNCIA RASTREÁVEL
                  </span>
                  <span
                    className="font-mono text-[10px] tracking-widest uppercase"
                    style={{ color: '#6b7fa3' }}
                  >
                    <span style={{ color: '#00d4aa' }}>●</span> ANÁLISE INDEPENDENTE
                  </span>
                </div>
              </div>

              {/* Photo side */}
              <div className="relative sm:w-[45%] h-52 sm:h-auto overflow-hidden">
                <div
                  className="hidden sm:block absolute inset-y-0 left-0 w-20 z-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to right, #0f1526, transparent)' }}
                />
                <div
                  className="sm:hidden absolute inset-x-0 top-0 h-12 z-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to bottom, #0f1526, transparent)' }}
                />
                <img
                  src="https://images.unsplash.com/photo-1766297247924-6638d54e7c89?w=600&h=440&fit=crop&auto=format"
                  alt="Dois cientistas analisando dados em computadores dentro de um laboratório"
                  className="w-full h-full object-cover opacity-80"
                />
                <div
                  className="absolute bottom-3 right-3 z-20 px-3 py-1 rounded-full border font-mono text-[10px] tracking-widest uppercase"
                  style={{ background: '#0f1526', borderColor: '#00d4aa', color: '#00d4aa' }}
                >
                  Checagem Científica
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="como" className="mt-24 space-y-8">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[--color-border]" />
            <span className="tracking-widest uppercase text-[26px]" style={{ fontFamily: '"Special Elite", cursive' }}>
              Como Funciona
            </span>
            <div className="flex-1 h-px bg-[--color-border]" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-stretch">
            {[
              {
                step: '01',
                title: 'Entrada',
                desc: 'Cole o URL ou envie um print do artigo que você quer verificar.',
                frontColor: '#4d9fff',
                backBg: '#e8f1ff',
                backBorder: '#4d9fff',
                backText: '#0a3060',
              },
              {
                step: '02',
                title: 'Análise',
                desc: 'Cada afirmação é confrontada com literatura científica indexada e bases de fatos.',
                frontColor: '#00d4aa',
                backBg: '#e0faf5',
                backBorder: '#00a882',
                backText: '#004d3a',
              },
              {
                step: '03',
                title: 'Veredicto',
                desc: 'Receba um score de credibilidade, alertas e links para as fontes originais.',
                frontColor: '#f5a623',
                backBg: '#fff8e8',
                backBorder: '#f5a623',
                backText: '#5a3a00',
              },
            ].map(({ step, title, desc, frontColor, backBg, backBorder, backText }) => (
              <div
                key={step}
                tabIndex={0}
                aria-label={`${step} — ${title}: ${desc}`}
                className="flip-card group rounded-lg outline-none"
                style={{ height: 160 }}
              >
                <div className="flip-card-inner w-full h-full">
                  {/* Front */}
                  <div
                    className="flip-card-front rounded-lg border border-[--color-border] bg-[--color-surface] flex flex-col items-center justify-center gap-2"
                    style={{ boxShadow: 'rgba(0,0,0,0.25) 0px 4px 4px 0px' }}
                  >
                    <div className="font-mono text-3xl font-semibold" style={{ color: frontColor }}>
                      {step}
                    </div>
                    <div
                      className="font-mono text-[11px] font-semibold tracking-widest uppercase"
                      style={{ color: frontColor }}
                    >
                      {title}
                    </div>
                  </div>
                  {/* Back */}
                  <div
                    className="flip-card-back rounded-lg border flex flex-col items-center justify-center p-5 text-center"
                    style={{
                      background: backBg,
                      borderColor: backBorder,
                      boxShadow: 'rgba(0,0,0,0.25) 0px 4px 4px 0px',
                    }}
                  >
                    <p className="text-sm leading-relaxed" style={{ color: backText, fontFamily: "'Lora', Georgia, serif", fontWeight: 500 }}>
                      {desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Academic Bases */}
        <section className="mt-16 space-y-8">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[--color-border]" />
            <span className="tracking-widest uppercase text-[26px]" style={{ fontFamily: '"Special Elite", cursive' }}>
              Bases Acadêmicas Consultadas
            </span>
            <div className="flex-1 h-px bg-[--color-border]" />
          </div>

          <div className="flex flex-wrap justify-center gap-6 sm:flex-nowrap sm:gap-8">
            {[
              {
                name: 'PubMed',
                icon: (
                  <svg width="44" height="22" viewBox="0 0 44 22" aria-hidden="true">
                    <text x="0" y="16" fontFamily="Instrument Sans, Arial, sans-serif" fontWeight="700" fontSize="13" fill="#00d4aa">Pub</text>
                    <text x="24" y="16" fontFamily="Instrument Sans, Arial, sans-serif" fontWeight="400" fontSize="13" fill="#6b9fc8">Med</text>
                  </svg>
                ),
              },
              {
                name: 'ScienceDirect',
                icon: (
                  <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                    <circle cx="16" cy="16" r="14" fill="none" stroke="#00d4aa" strokeWidth="2"/>
                    <text x="16" y="21" textAnchor="middle" fontFamily="Instrument Sans, Arial, sans-serif" fontWeight="700" fontSize="13" fill="#00d4aa">SD</text>
                  </svg>
                ),
              },
              {
                name: 'Nature',
                icon: (
                  <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true">
                    <text x="15" y="28" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="30" fill="#00d4aa">N</text>
                  </svg>
                ),
              },
              {
                name: 'Springer',
                icon: (
                  <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden="true">
                    <text x="0" y="14" fontFamily="Instrument Sans, Arial, sans-serif" fontWeight="600" fontSize="13" fill="#00d4aa">Springer</text>
                  </svg>
                ),
              },
              {
                name: 'SciELO',
                icon: (
                  <svg width="42" height="18" viewBox="0 0 42 18" aria-hidden="true">
                    <text x="0" y="14" fontFamily="Instrument Sans, Arial, sans-serif" fontWeight="700" fontSize="13" fill="#00d4aa">SciELO</text>
                  </svg>
                ),
              },
            ].map(({ name, icon }) => (
              <div key={name} className="flex flex-col items-center gap-2.5 group">
                <div
                  className="flex items-center justify-center rounded-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:border-[--color-teal]"
                  style={{
                    width: 56,
                    height: 56,
                    padding: '10px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                  }}
                >
                  {icon}
                </div>
                <span className="text-xs font-medium text-[--color-muted] group-hover:text-[--color-teal] transition-colors duration-200">{name}</span>
              </div>
            ))}
          </div>

          <p className="text-center font-mono text-[10px] text-[--color-subtle] tracking-wide">
            A seleção das fontes varia conforme o tema analisado.
          </p>
        </section>

        {/* Stats bar */}
        <section className="mt-12 border border-[--color-border] rounded-xl bg-[--color-surface] p-6">
          <div className="grid grid-cols-3 divide-x divide-[--color-border] text-center">
            {[
              { value: '98.4%', label: 'Precisão' },
              { value: '2.1s', label: 'Tempo médio' },
              { value: '40M+', label: 'Artigos indexados' },
            ].map(({ value, label }) => (
              <div key={label} className="px-4 space-y-1">
                <div className="font-mono text-2xl font-semibold text-[--color-teal]">{value}</div>
                <div className="font-mono text-[10px] text-[--color-muted] uppercase tracking-widest">{label}</div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-[--color-border] py-8">
        <div className="max-w-3xl mx-auto px-4 flex items-center justify-between">
          <span className="font-mono text-[11px] text-[--color-muted]">
            © 2026 ArtFact — Verificação científica independente
          </span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowTermsModal(true)}
              className="font-mono text-[11px] text-[--color-muted] px-3 py-1.5 rounded-md transition-all duration-150 hover:bg-white hover:text-black"
            >
              Privacidade
            </button>
            <a href="#" className="font-mono text-[11px] text-[--color-muted] hover:text-[--color-foreground] transition-colors">
              API
            </a>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {showLoginModal && (
        <LoginModal
          onClose={() => setShowLoginModal(false)}
          onLogin={handleLogin}
          onOpenTerms={() => setShowTermsModal(true)}
        />
      )}
      {showTermsModal && <TermsModal onClose={() => setShowTermsModal(false)} />}
      {showSaved && (
        <SavedPanel
          articles={savedArticles}
          onClose={() => setShowSaved(false)}
        />
      )}
    </div>
  )
}
