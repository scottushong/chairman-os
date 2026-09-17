import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import type { AiAdapter, AiBrief, CompanyContext, DailyBriefInput } from './adapter'
import { BRIEF_JSON_SCHEMA, BriefShapeError, parseBrief } from './brief-schema'

/**
 * AiAdapter의 Anthropic 구현.
 *
 * 모델은 env AI_MODEL, 없으면 claude-sonnet-4-5 (Phase 3-A 지시).
 * 프롬프트는 src/lib/ai/prompts/*.md 파일에서 읽는다 — 문장을 고치는 일이 코드 배포 검토와
 * 섞이지 않게 하고, 무엇을 시켰는지 파일 하나로 읽히게 하려는 것이다.
 * Vercel 번들에 이 파일들이 실리도록 next.config.ts의 outputFileTracingIncludes에 걸어 두었다.
 *
 * 출력은 JSON으로 강제한다(output_config.format = json_schema). 구조 강제를 지원하지 않는 모델을
 * AI_MODEL로 지정한 경우에만 400이 오는데, 그때는 같은 요청을 강제 없이 한 번 더 보내고
 * 본문을 JSON으로 읽는다. 어느 쪽이든 parseBrief()가 마지막 문지기다.
 */

export const DEFAULT_AI_MODEL = 'claude-sonnet-4-5'

const PROMPT_DIR = join(process.cwd(), 'src', 'lib', 'ai', 'prompts')

const promptCache = new Map<string, Promise<string>>()
function loadPrompt(name: 'company-summary' | 'daily-brief'): Promise<string> {
  let p = promptCache.get(name)
  if (!p) {
    p = readFile(join(PROMPT_DIR, `${name}.md`), 'utf8')
    promptCache.set(name, p)
  }
  return p
}

export function createAnthropicAdapter(): AiAdapter {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 가 없다.')

  const client = new Anthropic({ apiKey })
  const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL

  async function ask(promptName: 'company-summary' | 'daily-brief', payload: unknown): Promise<AiBrief> {
    const system = await loadPrompt(promptName)
    const params = {
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user' as const, content: JSON.stringify(payload) }],
    }

    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        ...params,
        output_config: { format: { type: 'json_schema', schema: BRIEF_JSON_SCHEMA } },
      })
    } catch (e) {
      // 구조 강제를 모르는 모델일 때만 한 번 물러선다. 다른 400(프롬프트·키 문제)은 그대로 올린다.
      if (!(e instanceof Anthropic.BadRequestError) || !/output_config|format|schema/i.test(e.message)) {
        throw e
      }
      response = await client.messages.create({
        ...params,
        system: `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 없이.\n${JSON.stringify(BRIEF_JSON_SCHEMA)}`,
      })
    }

    if (response.stop_reason === 'refusal') throw new Error('모델이 요청을 거절했다(refusal).')
    if (response.stop_reason === 'max_tokens') throw new Error('출력이 max_tokens에서 잘렸다.')

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new BriefShapeError(`JSON이 아니다: ${text.slice(0, 120)}`)
    }
    return parseBrief(json)
  }

  return {
    model,
    summarizeCompany: (input: CompanyContext) => ask('company-summary', input),
    generateDailyBrief: (input: DailyBriefInput) => ask('daily-brief', input),
  }
}
