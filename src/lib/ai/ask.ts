import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_AI_MODEL } from '@/lib/ai/anthropic'
import { latestPeriodOf } from '@/lib/finance'
import type { ChairmanRepository } from '@/lib/repository'
import type { AiSource, SessionUser } from '@/types'

/**
 * «AI에게 묻기» (Phase 9 블록 6 · CH-044).
 *
 * ■ 무엇을 AI에게 보여 주나 — **질문한 사람의 세션으로 읽은 것(RLS)만** ■
 *   repo는 그 사람의 쿠키로 만든 어댑터다. 회장은 전부, 직원은 자기 팀(subtree) · 회사 범위만 온다.
 *   이 파일은 권한을 새로 판정하지 않는다 — 읽혀 온 것을 추릴 뿐이다.
 *
 * ■ 재무는 한 번 더 막는다 ■ 재무 숫자(finance_kpis)는 [제한] 등급이다(0013 can_read_restricted:
 *   Chairman · GroupCFO · BusinessCEO · Executive). 그 밖의 역할이 재무를 물으면 **모델을 부르지 않고**
 *   «권한 없음»으로 답한다 — dummy 어댑터는 역할과 상관없이 숫자를 주므로, 역할로 한 번 더 가른다.
 *   (원문 검증: «AI에게 재무 질문 → 직원은 권한 없음».)
 *
 * ■ 결정하지 않는다 ■ 프롬프트(prompts/ask.md)가 막고, 화면이 답변마다 «결정 아님»을 붙인다.
 * ■ 근거 링크 ■ 모델이 낸 sources는 context에 실제로 있던 ref만 남긴다(지어낸 경로는 버린다).
 */

const FINANCE_ROLES = new Set(['Chairman', 'GroupCFO', 'BusinessCEO', 'Executive'])
const FINANCE_INTENT = /매출|ebitda|재무|현금|이익|원가|손익|런웨이|runway|revenue|profit|cash|finance|p&l/i

export interface AskResult {
  answer: string
  sources: AiSource[]
  /** 모델을 부르지 않고 규칙으로 답했나(권한 없음 · AI 연결 없음). */
  ruled: boolean
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'sources'],
  properties: {
    answer: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'href'],
        properties: { label: { type: 'string' }, href: { type: 'string' } },
      },
    },
  },
} as const

export async function buildAskContext(repo: ChairmanRepository, user: SessionUser) {
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
  const [businesses, kpis, exceptions, decisions, tasks, initiatives] = await Promise.all([
    safe(repo.listBusinesses()),
    safe(repo.listFinanceKpis()),
    safe(repo.listExceptions()),
    safe(repo.listDecisions()),
    safe(repo.listTasks()),
    safe(repo.listInitiatives()),
  ])
  const name = new Map(businesses.map((b) => [b.business_id, b.name]))
  const financeAllowed = FINANCE_ROLES.has(user.role) && kpis.length > 0
  const period = latestPeriodOf(kpis)

  const context = {
    businesses: businesses.filter((b) => b.visible).map((b) => ({ id: b.business_id, name: b.name, ref: `/business/${b.business_id}` })),
    finance: financeAllowed
      ? kpis
          .filter((k) => k.period === period && ['Revenue', 'EBITDA', 'Cash', 'OperatingProfit'].includes(k.metric))
          .map((k) => ({ business: name.get(k.business_id) ?? k.business_id, period: k.period, metric: k.metric, value: k.value, ref: `/finance/${k.business_id}` }))
      : [],
    exceptions: exceptions
      .filter((e) => e.status !== 'closed')
      .slice(0, 40)
      .map((e) => ({
        business: name.get(e.business_id) ?? e.business_id,
        rule: e.rule_key,
        severity: e.severity,
        // 값 · 임계는 재무 숫자일 수 있다 — 재무 권한이 없으면 빼고 규칙 · 등급만 남긴다.
        value: financeAllowed ? e.value : null,
        threshold: financeAllowed ? e.threshold : null,
        period: e.period,
        analysis: e.ai_analysis,
        ref: '/attention',
      })),
    decisions: decisions.slice(0, 40).map((d) => ({
      id: d.decision_id,
      title: d.title,
      business: name.get(d.business_id) ?? d.business_id,
      status: d.status,
      deadline: d.deadline,
      template: d.template_key ?? null,
      ref: `/approvals?id=${d.decision_id}`,
    })),
    purchase_requests: decisions
      .filter((d) => d.template_key === 'purchase')
      .map((d) => ({ id: d.decision_id, title: d.title, amount: d.form?.amount ?? null, status: d.status, ref: `/approvals?id=${d.decision_id}` })),
    tasks: tasks.slice(0, 40).map((t) => ({ id: t.task_id, title: t.title, status: t.status, deadline: t.deadline, ref: `/tasks/${t.task_id}` })),
    initiatives: initiatives
      .filter((i) => i.status === 'Active')
      .slice(0, 30)
      .map((i) => ({ id: i.initiative_id, title: i.title, stage: i.stage, next_action: i.next_action, next_action_date: i.next_action_date, blocker: i.blocker, ref: `/initiatives/${i.initiative_id}` })),
  }
  return { context, permissions: { finance: financeAllowed } }
}

let promptCache: Promise<string> | null = null

export async function answerQuestion(question: string, repo: ChairmanRepository, user: SessionUser): Promise<AskResult> {
  const lang = user.language
  const { context, permissions } = await buildAskContext(repo, user)

  if (FINANCE_INTENT.test(question) && !permissions.finance) {
    return {
      ruled: true,
      sources: [],
      answer:
        lang === 'en'
          ? 'No access — financial figures are Restricted and outside this account’s permissions. Please ask your CEO or the Group CFO.'
          : '권한 없음 — 재무 숫자는 [제한] 등급이라 이 계정이 볼 수 있는 범위 밖입니다. 필요하면 대표이사나 그룹 CFO에게 요청하세요.',
    }
  }

  const refs = new Set<string>(
    Object.values(context).flatMap((list) => (list as { ref: string }[]).map((x) => x.ref)),
  )

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return {
      ruled: true,
      sources: [],
      answer:
        lang === 'en'
          ? 'AI is not connected in this environment (ANTHROPIC_API_KEY missing), so no answer was generated.'
          : '이 환경에는 AI 연결(ANTHROPIC_API_KEY)이 없어 답을 만들지 못했습니다.',
    }
  }

  promptCache ??= readFile(join(process.cwd(), 'src', 'lib', 'ai', 'prompts', 'ask.md'), 'utf8')
  const system = await promptCache
  const client = new Anthropic({ apiKey: key })
  const response = await client.messages.create({
    model: process.env.AI_MODEL || DEFAULT_AI_MODEL,
    max_tokens: 1200,
    system,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ question, asker: { role: user.role, lang }, permissions, context }),
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  let parsed: { answer?: unknown; sources?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ruled: true, sources: [], answer: text.slice(0, 2000) || '답을 읽지 못했습니다.' }
  }
  const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
    .filter((s): s is AiSource => !!s && typeof s.href === 'string' && typeof s.label === 'string' && refs.has(s.href))
    .slice(0, 5)
  return { ruled: false, answer: String(parsed.answer ?? '').slice(0, 4000) || '답이 비었습니다.', sources }
}
