import type { Facts } from './insights'
import type { PortfolioFacts } from './portfolio'

/**
 * Free-tier text models, best first (per Google's pricing page). Pinned ids rather than a "-latest" alias:
 * an alias can silently move to a paid-only model, which makes free keys fail with quota errors.
 * Each model has its own free quota, so falling through this list also works around a per-model limit.
 */
export const FREE_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
export const DEFAULT_GEMINI_MODEL = FREE_MODELS[0]
const OK_MODEL_KEY = 'gemini-model-ok'
const lastGoodModel = () => {
  try {
    return localStorage.getItem(OK_MODEL_KEY) ?? undefined
  } catch {
    return undefined
  }
}
const rememberModel = (m: string) => {
  try {
    localStorage.setItem(OK_MODEL_KEY, m)
  } catch {
    /* storage unavailable */
  }
}

export type Tone = 'good' | 'watch' | 'alert'
export interface InsightReport {
  /** which Gemini model produced it */
  model?: string
  headline: string
  insights: { title: string; detail: string; tone: Tone }[]
  actions: string[]
}

const SYSTEM = `You are a sharp, friendly personal-finance analyst inside a budgeting app. Amounts are Sri Lankan rupees (Rs).
A "cycle" is a salary-to-salary budget month. You receive pre-computed FACTS as JSON; use ONLY those numbers, never invent or recompute figures.
Prioritise what matters: budget overruns, projected end-of-cycle spending vs income, categories rising versus last cycle or their
earlier average, unusual large expenses, savings rate, recurring commitments, and money friends still owe the user (friendsOweMeRs; already excluded from spending, so don't count it as spend). Mention what is going well too.
Every insight must cite concrete numbers from the facts. Actions must be specific and realistic (e.g. "Cap Food at Rs X for the rest of the cycle"),
not generic advice. If the data is thin (few cycles or transactions), say so briefly instead of guessing.
You are not a licensed financial advisor; do not recommend specific investments.`

const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'One-sentence overall verdict with a key number' },
    insights: {
      type: 'ARRAY',
      description: '3 to 5 insights, most important first',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Max 8 words' },
          detail: { type: 'STRING', description: '1-2 sentences citing numbers' },
          tone: { type: 'STRING', enum: ['good', 'watch', 'alert'] }
        },
        required: ['title', 'detail', 'tone']
      }
    },
    actions: { type: 'ARRAY', description: '2 to 3 specific next steps', items: { type: 'STRING' } }
  },
  required: ['headline', 'insights', 'actions']
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
      searchEntryPoint?: { renderedContent?: string }
    }
  }[]
  promptFeedback?: { blockReason?: string }
}

export interface Grounding {
  sources: { title: string; uri: string }[]
  /** Google's "Search Suggestions" chip HTML — must be shown when grounding is used */
  suggestionsHtml?: string
}

class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Google's own error message, when it sent one */
    readonly detail?: string,
    /** a different model might succeed (404, quota, overloaded, unsupported model) */
    readonly tryNext = false
  ) {
    super(message)
  }
}

/** Pull "error.message" out of Google's JSON error body. */
function googleMessage(raw: string): string {
  try {
    const m = (JSON.parse(raw) as { error?: { message?: string } }).error?.message
    if (m) return m.replace(/\s+/g, ' ').slice(0, 220)
  } catch {
    /* not JSON */
  }
  return raw.replace(/\s+/g, ' ').slice(0, 160)
}

async function callOnce(
  opts: { apiKey: string; user: string; system?: string; json?: boolean; search?: boolean },
  model: string
): Promise<{ text: string; grounding?: Grounding }> {
  const body = {
    systemInstruction: { parts: [{ text: opts.system ?? SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    ...(opts.search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      // Newer models spend part of this budget on hidden "thinking", so keep generous headroom.
      // (No temperature override: Gemini 3 models are tuned for their default.)
      maxOutputTokens: opts.search ? 6144 : 4096,
      ...(opts.json ? { responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA } : {})
    }
  }
  let res: Response
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body)
    })
  } catch {
    throw new GeminiError('Could not reach Gemini — check your internet connection and try again.')
  }
  if (!res.ok) {
    const detail = googleMessage(await res.text().catch(() => ''))
    const keyProblem = /api key|API_KEY|referer|referrer|not authorized|permission denied.*key/i.test(detail)
    if (keyProblem || res.status === 401)
      throw new GeminiError(`Gemini rejected your API key (${detail || res.status}). Check it in Settings → AI insights.`, res.status, detail)
    // Schema/tool problems are the caller's to handle (retry without them) — a different model won't help
    const featureProblem = /schema|response_?mime|json payload|unknown name|tools?\b|google_search|grounding/i.test(detail)
    if (res.status === 400 && featureProblem) throw new GeminiError(`Gemini couldn't process the request (${detail}).`, 400, detail)
    const modelProblem =
      res.status === 404 ||
      res.status === 429 ||
      res.status === 500 ||
      res.status === 503 ||
      ((res.status === 400 || res.status === 403) && /model|not (?:found|supported)|unsupported|not available|permission/i.test(detail))
    throw new GeminiError(`Gemini error ${res.status} on ${model}: ${detail || 'no details'}`, res.status, detail, modelProblem)
  }
  const data = (await res.json()) as GeminiResponse
  const cand = data.candidates?.[0]
  // Skip any "thought" parts; only the final answer text is wanted
  const text = cand?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
  if (!text) {
    if (data.promptFeedback?.blockReason) throw new GeminiError('The request was blocked by Gemini.')
    if (cand?.finishReason === 'MAX_TOKENS') throw new GeminiError('The answer was cut off before it started — tap again.', undefined, undefined, true)
    throw new GeminiError('Gemini returned an empty answer — tap again.', undefined, undefined, true)
  }
  if (cand?.finishReason === 'MAX_TOKENS' && opts.json) throw new GeminiError('The answer was cut off — tap again.', undefined, undefined, true)
  const gm = cand?.groundingMetadata
  const sources = (gm?.groundingChunks ?? [])
    .map(c => ({ title: c.web?.title ?? '', uri: c.web?.uri ?? '' }))
    .filter(c => /^https?:\/\//.test(c.uri))
  const grounding = gm ? { sources: dedupe(sources), suggestionsHtml: gm.searchEntryPoint?.renderedContent } : undefined
  return { text, grounding }
}

/** Try the chosen model, then the remembered-good one, then the free-tier list, until one answers. */
async function generate(opts: {
  apiKey: string
  model?: string
  user: string
  system?: string
  json?: boolean
  /** enable Grounding with Google Search */
  search?: boolean
}): Promise<{ text: string; grounding?: Grounding; model: string }> {
  const candidates = [...new Set([opts.model?.trim(), lastGoodModel(), ...FREE_MODELS].filter((m): m is string => !!m))].slice(0, 5)
  const failures: GeminiError[] = []
  for (const model of candidates) {
    try {
      const out = await callOnce(opts, model)
      rememberModel(model)
      return { ...out, model }
    } catch (e) {
      if (!(e instanceof GeminiError) || !e.tryNext) throw e
      failures.push(e)
    }
  }
  const quota = failures.filter(f => f.status === 429).length
  const last = failures[failures.length - 1]
  if (quota === failures.length)
    throw new GeminiError(
      `Free quota is used up on all the models I tried (${candidates.join(', ')}). Per-minute limits clear in a minute; daily ones reset at midnight Pacific time. Last message: ${last?.detail ?? ''}`.trim(),
      429
    )
  throw last ?? new GeminiError('Gemini is not responding — try again shortly.')
}

/** Settings → "Test connection": shows which model answered, or Google's exact complaint. */
export async function testGemini(apiKey: string, model?: string): Promise<string> {
  const out = await generate({ apiKey, model, system: 'Reply with one short word.', user: 'Say OK.' })
  return out.model
}

function dedupe(list: { title: string; uri: string }[]) {
  const seen = new Set<string>()
  return list.filter(x => (seen.has(x.uri) ? false : (seen.add(x.uri), true)))
}

function parseReport(text: string): InsightReport {
  // Be tolerant of code fences if the model ignored JSON mode
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const r = JSON.parse(clean) as Partial<InsightReport>
  if (typeof r.headline !== 'string' || !Array.isArray(r.insights)) throw new Error('bad shape')
  return {
    headline: r.headline,
    insights: r.insights
      .filter(i => i && typeof i.title === 'string' && typeof i.detail === 'string')
      .map(i => ({ title: i.title, detail: i.detail, tone: (['good', 'watch', 'alert'] as const).includes(i.tone) ? i.tone : 'watch' })),
    actions: Array.isArray(r.actions) ? r.actions.filter(a => typeof a === 'string') : []
  }
}

/** Structured analysis of the selected cycle. */
export async function analyze(opts: { apiKey: string; model?: string; facts: Facts }): Promise<InsightReport> {
  const user = `FACTS:\n${JSON.stringify(opts.facts)}\n\nAnalyse this cycle and respond as JSON with a headline, 3-5 insights and 2-3 actions.`
  const run = (json: boolean) => generate({ apiKey: opts.apiKey, model: opts.model, user, json })
  let text = ''
  let usedModel = ''
  try {
    const first = await run(true)
    text = first.text
    usedModel = first.model
  } catch (e) {
    // If the model/endpoint rejects the schema options (400 not about the key), retry in plain mode
    if (e instanceof GeminiError && e.status === 400) {
      const second = await run(false)
      text = second.text
      usedModel = second.model
    }
    else throw e
  }
  try {
    return { ...parseReport(text), model: usedModel }
  } catch {
    throw new Error('Gemini answered in an unexpected format — tap Analyse again.')
  }
}

/** Free-form follow-up question about the same facts. */
export async function ask(opts: { apiKey: string; model?: string; facts: Facts; question: string }): Promise<string> {
  const user = `FACTS:\n${JSON.stringify(opts.facts)}\n\nQuestion: ${opts.question}\n\nAnswer in under 200 words, plain text, short "- " bullets, citing numbers from the facts.`
  return (await generate({ apiKey: opts.apiKey, model: opts.model, user })).text
}

// ───────────────────────── Market / portfolio analysis ─────────────────────────

const MARKET_SYSTEM = `You are a careful investment-portfolio analyst inside a personal budgeting app for a user in Sri Lanka. Amounts are Rs (LKR).
You receive PORTFOLIO FACTS (JSON, computed by the app — use only these figures for the user's holdings, never recompute or invent them).
Your job: (1) analyse the portfolio's structure — concentration, mix of stable vs volatile assets, USD/currency exposure, FD maturities coming up,
emergency-fund cover, assets with gains/losses, stale prices; (2) use Google Search to bring in CURRENT market context that is relevant to what
the user actually holds (e.g. gold price trend, relevant crypto/stock news, USD/LKR movement, Sri Lankan FD / T-bill rate environment, CSE
conditions only if they hold local stocks). Say when something is from search and keep each market note to what is sourced; if you can't find
reliable current information, say so rather than guessing.
You provide information and things to consider, NOT personalised financial advice: never tell the user to buy, sell or hold a specific asset and never give
price targets or predictions presented as certain. Frame next steps as reviews, checks and questions to consider (e.g. "review whether 70% in one stock fits
your risk tolerance"). Be concrete with numbers from the facts. Respond with ONLY a JSON object, no markdown fences.`

export interface MarketReport {
  model?: string
  headline: string
  portfolio: { title: string; detail: string; tone: Tone }[]
  market: { topic: string; summary: string }[]
  actions: string[]
  grounding?: Grounding
  /** true when live search was requested but unavailable, so the answer is holdings-only */
  searchUnavailable?: boolean
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json')
  return JSON.parse(text.slice(start, end + 1))
}

function parseMarket(text: string): Omit<MarketReport, 'grounding' | 'searchUnavailable'> {
  const r = extractJson(text) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const list = <T,>(v: unknown, f: (x: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(v) ? v : []).flatMap(x => (x && typeof x === 'object' ? [f(x as Record<string, unknown>)] : [])).filter((x): x is T => x !== null)
  const headline = str(r.headline)
  if (!headline) throw new Error('bad shape')
  return {
    headline,
    portfolio: list(r.portfolio, x =>
      str(x.title) && str(x.detail)
        ? { title: str(x.title), detail: str(x.detail), tone: (['good', 'watch', 'alert'] as const).find(t => t === x.tone) ?? 'watch' }
        : null
    ),
    market: list(r.market, x => (str(x.topic) && str(x.summary) ? { topic: str(x.topic), summary: str(x.summary) } : null)),
    actions: (Array.isArray(r.actions) ? r.actions : []).filter((a): a is string => typeof a === 'string')
  }
}

const MARKET_FORMAT = `Respond with JSON: {"headline": string (one sentence), "portfolio": [{"title": string (max 8 words), "detail": string (1-2 sentences with numbers), "tone": "good"|"watch"|"alert"}] (3-5 items),
"market": [{"topic": string, "summary": string (1-2 sentences, current, from search)}] (2-4 items, may be empty if search found nothing reliable),
"actions": [string] (2-3 things to review or consider)}.`

/** Portfolio analysis + current market context via Google Search grounding (falls back to holdings-only). */
export async function analyzeMarket(opts: { apiKey: string; model?: string; facts: PortfolioFacts; useSearch?: boolean }): Promise<MarketReport> {
  const user = `PORTFOLIO FACTS:
${JSON.stringify(opts.facts)}

Today is ${opts.facts.today}. ${MARKET_FORMAT}`
  const run = (search: boolean) => generate({ apiKey: opts.apiKey, model: opts.model, system: MARKET_SYSTEM, user, search })
  let out: { text: string; grounding?: Grounding; model: string }
  let searchUnavailable = false
  if (opts.useSearch === false) {
    out = await run(false)
  } else {
    try {
      out = await run(true)
    } catch (e) {
      // Search tool rejected or its quota is used up: still give a holdings-only analysis
      if (e instanceof GeminiError && (e.status === 400 || e.status === 429)) {
        searchUnavailable = true
        out = await run(false)
      } else throw e
    }
  }
  try {
    return { ...parseMarket(out.text), grounding: out.grounding, searchUnavailable, model: out.model }
  } catch {
    throw new Error('Gemini answered in an unexpected format — tap Analyse again.')
  }
}
