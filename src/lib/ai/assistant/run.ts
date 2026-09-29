import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { estimateCostUsd } from '@/lib/ai/pricing'
import type { ChairmanRepository } from '@/lib/repository'
import type { AiChatMessage, AiSource, Business, SessionUser } from '@/types'

import { FINANCE_ROLES, type AssistantTool, type ToolContext } from './kit'
import { SCREEN_LABEL_KO, screenSubject } from './screen'
import { businessesTool, calculateTool, financeTool, initiativeTool, initiativesTool } from './tools-core'
import { approvalsTool, attachmentsTool, attentionTool, calendarTool, dependencyTool, directionTool, orgTool } from './tools-more'
import {
  proposeApprovalTool,
  proposeCheckinTool,
  proposeEventTool,
  proposeInitiativeTool,
  proposeMemoTool,
  proposeSummaryTool,
} from './tools-propose'
import { validateTool } from './validate'

/**
 * AI 어시스턴트의 한 번(질문 하나 → 답 하나). Phase 9 «AI에게 묻기»(lib/ai/ask.ts)를 대신한다.
 *
 * ■ 모델을 부르기 전에 규칙으로 답하는 셋 ■
 *   ① 앱 코드 · 화면을 바꾸라는 요청 → «개발 세션에서 처리합니다» 한 줄(회장 지시). 프롬프트도 같은 말을
 *      시키지만, 첫 문은 코드다 — 모델이 친절하게 «그래프를 추가했습니다»라고 지어내는 길을 먼저 닫는다.
 *   ② 재무 질문 + 재무 권한 없음 → «권한 없음»(Phase 9와 같은 두 겹. 재무 도구도 그 사람에게 주지 않는다).
 *   ③ 이 대화의 토큰이 상한을 넘음 → 새 대화를 열라고 말한다.
 * ■ 도구는 그 사람의 repo로 읽는다 ■ kit.ts 머리 주석. 쓰기는 제안(pending)까지만 — 실행 코드는 여기 없다.
 * ■ 근거 카드는 도구가 실제로 읽은 줄에서 코드가 만든다 ■ 모델이 쓴 링크는 카드가 되지 않는다.
 */

export const DEV_SESSION_LINE = '개발 세션에서 처리합니다'

const FINANCE_INTENT = /매출|ebitda|재무|현금|이익|원가|손익|런웨이|runway|revenue|profit|cash|finance|p&l|영업이익|순이익|비용 합계|전표|장부|결산/i

/** UI 낱말 + 만들기 · 바꾸기 동사. «다음 행동 바꿔줘»(데이터)는 걸리지 않고 «대시보드에 그래프 추가»(화면)는 걸린다. */
const UI_OBJECT = /(그래프|차트|위젯|메뉴|버튼|탭|레이아웃|디자인|ui|사이드바|코드|기능|폰트|색깔|테마\s*색)[^.?!\n]{0,24}(추가|넣어|넣자|만들어|바꿔|변경|수정|없애|삭제|개발|구현|붙여|달아)/i
const UI_PLACE = /(대시보드|화면|페이지|앱|홈)(에|에다|에서|의)?\s[^.?!\n]{0,24}(추가|넣어|만들어|붙여|달아)/i
const DATA_WORDS = /일정|결재|기안|메모|체크인|다음\s*행동|이니셔티브|전표|첨부|목표일/

export function isAppChangeRequest(q: string): boolean {
  if (UI_OBJECT.test(q)) return true
  return UI_PLACE.test(q) && !DATA_WORDS.test(q)
}

export function isFinanceQuestion(q: string): boolean {
  return FINANCE_INTENT.test(q)
}

/** 대화 하나의 토큰 상한(입력+출력 합). env로 바꿀 수 있다. 기본 200k ≈ Sonnet 기준 1~2달러. */
export function chatTokenLimit(): number {
  const n = Number(process.env.AI_ASSISTANT_CHAT_TOKEN_LIMIT)
  return Number.isFinite(n) && n > 0 ? n : 200_000
}

/** 답 하나 안의 도구 왕복 상한. 넘으면 그때까지 모은 것으로 답을 끝낸다. */
const MAX_TURNS = 8

export const ALL_TOOLS: AssistantTool[] = [
  calculateTool,
  businessesTool,
  financeTool,
  initiativesTool,
  initiativeTool,
  approvalsTool,
  calendarTool,
  orgTool,
  attachmentsTool,
  dependencyTool,
  attentionTool,
  directionTool,
  validateTool,
  proposeInitiativeTool,
  proposeEventTool,
  proposeApprovalTool,
  proposeCheckinTool,
  proposeMemoTool,
  proposeSummaryTool,
]

export interface AssistantAnswer {
  answer: string
  sources: AiSource[]
  actionIds: string[]
  tokens: number
  /** 모델을 부르지 않고 규칙으로 답했나. */
  ruled: boolean
}

export interface AssistantRequest {
  question: string
  repo: ChairmanRepository
  user: SessionUser
  /** 질문을 연 화면(앱 안 경로). */
  path: string
  chatId: string | null
  /** 이 대화의 앞선 메시지(방금 질문은 빼고). */
  history: AiChatMessage[]
  channel?: 'web' | 'kakao'
}

export function makeContext(req: AssistantRequest): ToolContext {
  let businesses: Promise<Business[]> | null = null
  return {
    repo: req.repo,
    user: req.user,
    screen: screenSubject(req.path),
    chatId: req.chatId,
    channel: req.channel ?? 'web',
    financeAllowed: FINANCE_ROLES.has(req.user.role),
    evidence: [],
    actionIds: [],
    businesses: () => (businesses ??= req.repo.listBusinesses().then((l) => l.filter((b) => b.visible)).catch(() => [])),
  }
}

function ruled(answer: string): AssistantAnswer {
  return { answer, sources: [], actionIds: [], tokens: 0, ruled: true }
}

let promptCache: Promise<string> | null = null

export async function runAssistant(req: AssistantRequest): Promise<AssistantAnswer> {
  const en = req.user.language === 'en'
  const q = req.question.trim()
  const ctx = makeContext(req)

  if (isAppChangeRequest(q)) return ruled(DEV_SESSION_LINE)
  // 카카오 창구는 [제한] 등급을 싣지 않는다(lib/kakao/assistant.ts) — 재무는 감사가 붙는 앱에서.
  if (ctx.channel === 'kakao' && isFinanceQuestion(q)) {
    return { ...ruled('재무 숫자는 카카오로 보내지 않습니다. 앱의 재무 화면에서 확인하세요.'), sources: [{ label: '재무', href: '/finance' }] }
  }
  if (isFinanceQuestion(q) && !ctx.financeAllowed) {
    return ruled(
      en
        ? 'No access — financial figures are Restricted and outside this account’s permissions. Please ask your CEO or the Group CFO.'
        : '권한 없음 — 재무 숫자는 [제한] 등급이라 이 계정이 볼 수 있는 범위 밖입니다. 필요하면 대표이사나 그룹 CFO에게 요청하세요.',
    )
  }
  const used = req.history.reduce((a, m) => a + (m.tokens ?? 0), 0)
  if (used >= chatTokenLimit()) {
    return ruled(`이 대화가 토큰 상한(${chatTokenLimit().toLocaleString('ko-KR')})에 닿았습니다. 새 대화를 열어 이어서 물어 주세요.`)
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return ruled(en ? 'AI is not connected in this environment (ANTHROPIC_API_KEY missing).' : '이 환경에는 AI 연결(ANTHROPIC_API_KEY)이 없어 답을 만들지 못했습니다.')

  promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'assistant.md'), 'utf8')
  const system = await promptCache
  const tools = ALL_TOOLS.filter((t) => t.available(ctx))
  const byName = new Map(tools.map((t) => [t.def.name, t]))
  const model = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL
  const client = new Anthropic({ apiKey: key })

  const s = ctx.screen
  const head = `[화면] ${SCREEN_LABEL_KO[s.kind]}${s.id ? ` · id=${s.id}` : ''} · 경로 ${s.path} · 묻는 사람 역할 ${req.user.role} · 오늘 ${new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)}(KST)${ctx.channel === 'kakao' ? ' · 창구 카카오(읽기만 — 고치자는 요청에는 제안하지 말고 «앱에서 하실 수 있습니다»라고 답한다)' : ''}`
  // 앞선 대화는 글만 싣는다(도구 왕복은 다시 싣지 않는다 — 근거는 이번 답에서 다시 읽는다). 최근 12개.
  const messages: Anthropic.MessageParam[] = [
    ...req.history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: 'user', content: `${head}\n\n${q}` },
  ]

  let input = 0
  let output = 0
  let text = ''
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        system,
        tools: tools.map((t) => t.def),
        messages,
      })
      input += res.usage.input_tokens
      output += res.usage.output_tokens
      text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim()
      if (res.stop_reason !== 'tool_use') {
        if (res.stop_reason === 'refusal') text = '이 질문에는 답하지 못했습니다.'
        break
      }
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      messages.push({ role: 'assistant', content: res.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      // 차례로 돈다 — 제안(쓰기 줄 만들기)이 섞일 수 있어 동시에 돌리지 않는다.
      for (const u of uses) {
        const tool = byName.get(u.name)
        let out: unknown
        try {
          out = tool ? await tool.run((u.input ?? {}) as Record<string, unknown>, ctx) : { error: `없는 도구: ${u.name}` }
        } catch (e) {
          console.error('[assistant] 도구 실패', u.name, e)
          out = { error: /row-level security|42501|permission/i.test(e instanceof Error ? e.message : '') ? '권한 밖입니다.' : '도구가 실패했습니다.' }
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60_000) })
      }
      messages.push({ role: 'user', content: results })
      if (turn === MAX_TURNS - 1) text ||= '도구를 여러 번 불렀지만 답을 끝내지 못했습니다. 질문을 좁혀 주세요.'
    }
  } finally {
    if (input + output > 0) {
      await req.repo
        .logAiUsage({
          feature: ctx.channel === 'kakao' ? 'assistant_kakao' : 'assistant',
          model,
          input_tokens: input,
          output_tokens: output,
          estimated_cost_usd: estimateCostUsd(model, input, output),
          entity_table: req.chatId ? 'ai_chats' : null,
          entity_id: req.chatId,
        })
        .catch((e) => console.error('[assistant] ai_usage_log 실패', e))
    }
  }

  // 제안이 섰는데 모델이 «저장했다»고 말하면 고쳐 적는다 — 확인 전에는 아무것도 바뀌지 않았다.
  if (ctx.actionIds.length && /저장했|바꿨|변경했|추가했|올렸습니다|기록했/.test(text) && !/확인/.test(text)) {
    text += '\n\n(아직 저장되지 않았습니다 — 아래 [확인]을 누르셔야 반영됩니다.)'
  }
  return {
    answer: (text || '답이 비었습니다.').slice(0, 7000),
    sources: ctx.evidence.slice(0, 8),
    actionIds: ctx.actionIds.slice(0, 10),
    tokens: input + output,
    ruled: false,
  }
}
