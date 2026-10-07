import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptBackendResult } from '../src/adapters.ts'
import { analyzeArticle, normalizeArticleReference } from '../src/api.ts'

function claimResult(claim, supports, contradicts, url) {
  return {
    user_summary: {
      claim,
      evidence_balance: { SUPPORTS: supports, CONTRADICTS: contradicts },
      findings: url ? [{ finding_pt: `Evidência de ${claim}`, relation: supports ? 'SUPPORTS' : 'CONTRADICTS', confidence: 0.9, source_url: url }] : [],
      caveats: [`Limite de ${claim}`],
    },
    report: { sources: url ? [{ label: claim, url }] : [] },
  }
}

test('includes secondary evidence without counting the mirrored first result twice', () => {
  const first = claimResult('Primeira', 1, 0, 'https://example.org/first')
  const second = claimResult('Segunda', 0, 1, 'https://example.org/second')
  const result = adaptBackendResult({
    ...first,
    submitted_article: { title: 'Artigo', source: '12345678' },
    claim_analyses: [
      { claim: { text: 'Primeira' }, result: first },
      { claim: { text: 'Segunda' }, result: second },
    ],
  }, 'analysis')
  assert.equal(result.credibilityScore, 50)
  assert.equal(result.overallVerdict, 'uncertain')
  assert.equal(result.title, 'Artigo')
  assert.equal(result.claims.length, 2)
  assert.equal(result.claims[1].verdict, 'fake')
  assert.match(result.claims[1].note, /Alegação: Segunda/)
  assert.ok(result.redFlags.some(flag => flag.includes('Segunda')))
  assert.deepEqual(result.supportingLinks.map(link => link.url), ['https://example.org/first', 'https://example.org/second'])
  assert.match(result.supportingLinks[1].label, /Segunda/)
})

test('weights the overall percentage by direct evidence counts', () => {
  const result = adaptBackendResult({ claim_analyses: [
    { claim: { text: 'Primeira' }, result: claimResult('Primeira', 3, 0) },
    { claim: { text: 'Segunda' }, result: claimResult('Segunda', 0, 1) },
  ] }, 'analysis')
  assert.equal(result.credibilityScore, 75)
  assert.equal(result.overallVerdict, 'verified')
})

test('keeps legacy single-result responses and empty arrays compatible', () => {
  const data = claimResult('Uma alegação', 0, 1, 'https://example.org/source')
  const result = adaptBackendResult(data, 'legacy')
  assert.equal(result.overallVerdict, 'fake')
  assert.equal(result.claims.length, 1)
  assert.deepEqual(adaptBackendResult({ ...data, claim_analyses: [] }, 'legacy'), result)
})

test('shows claims without comparable evidence instead of dropping them', () => {
  const result = adaptBackendResult({ claim_analyses: [
    { claim: { text: 'Sem evidência' }, result: {} },
  ] }, 'analysis')
  assert.equal(result.claims[0].text, 'Sem evidência')
  assert.equal(result.claims[0].verdict, 'uncertain')
  assert.equal(result.credibilityScore, 0)
})

test('normalizes bare PubMed URLs while preserving other reference formats', () => {
  for (const input of ['pubmed.ncbi.nlm.nih.gov/12345678/', '//pubmed.ncbi.nlm.nih.gov/12345678/']) {
    assert.equal(normalizeArticleReference(` ${input} `), 'https://pubmed.ncbi.nlm.nih.gov/12345678/')
  }
  for (const input of ['12345678', '10.1000/example', 'doi:10.1000/example', 'https://doi.org/10.1000/example', 'http://pubmed.ncbi.nlm.nih.gov/12345678/', 'pubmed.ncbi.nlm.nih.gov.example.org/12345678/']) {
    assert.equal(normalizeArticleReference(` ${input} `), input)
  }
})

test('sends the normalized reference through the analysis request', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ analysis_id: 'job', status: 'SUCCEEDED', progress: 100, result: {} }), { status: 200 })
  })
  await analyzeArticle({ articleReference: ' pubmed.ncbi.nlm.nih.gov/12345678/ ' })
  assert.equal(JSON.parse(requests[0].options.body).article_reference, 'https://pubmed.ncbi.nlm.nih.gov/12345678/')
  assert.equal(requests[0].options.method, 'POST')
})
