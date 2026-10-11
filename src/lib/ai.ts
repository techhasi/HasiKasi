import type { Facts } from './insights'

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

export type Tone = 'good' | 'watch' | 'alert'
export interface InsightReport {
  headline: string
  insights: { title: string; detail: string; tone: Tone }[]
  actions: string[]
}

const SYSTEM = `You are a sharp, friendly personal-finance analyst inside a budgeting app. Amounts are Sri Lankan rupees (Rs).
A "cycle" is a salary-to-salary budget month. You receive pre-computed FACTS as JSON; use ONLY those numbers, never invent or recompute figures.
Prioritise what matters: budget overruns, projected end-of-cycle spending vs income, categories rising versus last cycle or their
earlier average, unusual large expenses, savings rate, and recurring commitments. Mention what is going well too.
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
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

class GeminiError extends Error {
  constructor(message: string, readonly status?: number, readonly raw?: string) {
    super(message)
  }
}

async function generate(opts: {
  apiKey: string
  model?: string
  user: string
  json?: boolean
}): Promise<string> {
  const model = (opts.model || DEFAULT_GEMINI_MODEL).trim()
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: 0.3,
      // Newer models spend part of this budget on hidden "thinking", so keep generous headroom
      maxOutputTokens: 4096,
      ...(opts.json ? { responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA } : {})
    }
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    if (res.status === 429) throw new GeminiError('Free quota reached for now — try again in a minute (or tomorrow if the daily limit is used).', 429, raw)
    if (res.status === 404) throw new GeminiError(`Model “${model}” was not found — check the model name in Settings.`, 404, raw)
    if (/api key|API_KEY/i.test(raw) || res.status === 401 || res.status === 403)
      throw new GeminiError('Gemini rejected your API key — check it in Settings → AI insights.', res.status, raw)
    throw new GeminiError(`Gemini error (${res.status}). Try again shortly.`, res.status, raw)
  }
  const data = (await res.json()) as GeminiResponse
  const cand = data.candidates?.[0]
  // Skip any "thought" parts; only the final answer text is wanted
  const text = cand?.content?.parts?.filter(p => !p.thought).map(p => p.text ?? '').join('').trim()
  if (!text) {
    if (data.promptFeedback?.blockReason) throw new GeminiError('The request was blocked by Gemini.')
    if (cand?.finishReason === 'MAX_TOKENS') throw new GeminiError('The answer was cut off before it started — try again, or choose a lighter model in Settings.')
    throw new GeminiError('Gemini returned an empty answer. Try again.')
  }
  if (cand?.finishReason === 'MAX_TOKENS' && opts.json) throw new GeminiError('The answer was cut off — try again.')
  return text
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
  let text: string
  try {
    text = await run(true)
  } catch (e) {
    // If the model/endpoint rejects the schema options (400 not about the key), retry in plain mode
    if (e instanceof GeminiError && e.status === 400) text = await run(false)
    else throw e
  }
  try {
    return parseReport(text)
  } catch {
    throw new Error('Gemini answered in an unexpected format — tap Analyse again.')
  }
}

/** Free-form follow-up question about the same facts. */
export async function ask(opts: { apiKey: string; model?: string; facts: Facts; question: string }): Promise<string> {
  const user = `FACTS:\n${JSON.stringify(opts.facts)}\n\nQuestion: ${opts.question}\n\nAnswer in under 200 words, plain text, short "- " bullets, citing numbers from the facts.`
  return generate({ apiKey: opts.apiKey, model: opts.model, user })
}
