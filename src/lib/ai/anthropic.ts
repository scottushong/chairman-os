import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import type {
  AiAdapter,
  AiBrief,
  CompanyContext,
  DailyBriefInput,
  ExceptionAnalysis,
  ExceptionContext,
} from './adapter'
import { BRIEF_JSON_SCHEMA, BriefShapeError, DAILY_BRIEF_JSON_SCHEMA, parseBrief } from './brief-schema'
import { EXCEPTION_ANALYSIS_JSON_SCHEMA, parseExceptionAnalysis } from './exception-schema'

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

type PromptName = 'company-summary' | 'daily-brief' | 'exception-analysis'

const promptCache = new Map<string, Promise<string>>()
function loadPrompt(name: PromptName): Promise<string> {
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

  /**
   * 한 번의 호출. 구조 강제 → 물러서기 → JSON 파싱까지가 여기 있고, **돌아온 값을 무엇으로
   * 읽을지는 호출자가 정한다**(브리핑이냐 예외 분석이냐). 세 프롬프트가 같은 실패 처리를
   * 쓰게 하려고 이 자리를 가른 것이다 — 두 벌이 되면 한쪽만 refusal을 못 보게 된다.
   */
  async function callJson(
    promptName: PromptName,
    payload: unknown,
    schema: { [key: string]: unknown },
    maxTokens: number,
  ): Promise<unknown> {
    const system = await loadPrompt(promptName)
    const params = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user' as const, content: JSON.stringify(payload) }],
    }

    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        ...params,
        output_config: { format: { type: 'json_schema', schema } },
      })
    } catch (e) {
      // 구조 강제를 모르는 모델일 때만 한 번 물러선다. 다른 400(프롬프트·키 문제)은 그대로 올린다.
      if (!(e instanceof Anthropic.BadRequestError) || !/output_config|format|schema/i.test(e.message)) {
        throw e
      }
      response = await client.messages.create({
        ...params,
        system: `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다. 코드블록 표시 없이.\n${JSON.stringify(schema)}`,
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

    try {
      return JSON.parse(text)
    } catch {
      throw new BriefShapeError(`JSON이 아니다: ${text.slice(0, 120)}`)
    }
  }

  async function ask(promptName: 'company-summary' | 'daily-brief', payload: unknown): Promise<AiBrief> {
    // 그룹 브리핑만 project_notes를 더 받는다(Phase 3-B).
    const daily = promptName === 'daily-brief'
    const schema = daily ? DAILY_BRIEF_JSON_SCHEMA : BRIEF_JSON_SCHEMA
    // 그룹 브리핑은 회사 5곳 요약 + 항목 7개 + 프로젝트별 한 줄을 한 응답에 담는다.
    // 4000에서 실제로 잘렸다(2026-09-19 회장 첫 사용). 12000은 그 세 배 여유다 —
    // 길이 자체는 daily-brief.md의 상한이 잡고, 이 숫자는 그 상한을 지킨 응답이
    // 절대 잘리지 않도록 두는 천장이다.
    const json = await callJson(promptName, payload, schema, 12_000)
    return parseBrief(json, { projectNotes: daily })
  }

  return {
    model,
    summarizeCompany: (input: CompanyContext) => ask('company-summary', input),
    generateDailyBrief: (input: DailyBriefInput) => ask('daily-brief', input),
    /**
     * 블록 B-2. 예외 하나의 분석(§18). 출력이 문장 셋이라 천장이 브리핑보다 훨씬 낮다 —
     * 2000이면 두세 문장 × 2 + 수 하나가 잘릴 일이 없고, 예외가 밤마다 여러 건씩 돌아서
     * 브리핑의 천장을 그대로 쓰면 한 회사가 규칙 셋에 걸린 날 값이 커진다.
     */
    analyzeException: async (input: ExceptionContext): Promise<ExceptionAnalysis> =>
      parseExceptionAnalysis(
        await callJson('exception-analysis', input, EXCEPTION_ANALYSIS_JSON_SCHEMA, 2_000),
      ),
  }
}
