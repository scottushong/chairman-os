import 'server-only'

import { structureMemo } from '@/lib/attachments/summarize'
import { kstToday } from '@/lib/chairman-project'
import { MEAL_MAX } from '@/lib/checkin'
import {
  AI_ACTION_LABEL_KO,
  EVENT_KIND,
  INITIATIVE_KIND,
  INITIATIVE_STAGE,
  INITIATIVE_STAGE_LABEL_KO,
  INITIATIVE_STATUS,
  WORK_PRIORITY,
  type AiActionKind,
  type AiActionPreview,
  type Initiative,
} from '@/types'

import { INITIATIVE_ROLES, resolveBusiness, str, strList, type AssistantTool, type ToolContext } from './kit'
import { findInitiative } from './tools-core'

/**
 * 쓰기 제안 도구 여섯 — **실행하지 않는다.** 하는 일은 셋뿐이다:
 *   ① 입력을 검사하고 지금 값을 읽어 «전 → 후» 미리보기를 만든다.
 *   ② ai_actions에 pending 줄을 넣는다(0046 — 상태 · 만료 · 주인은 DB가 정한다).
 *   ③ 모델에게 «확인 버튼이 떴고 아직 아무것도 바뀌지 않았다»고 돌려준다.
 * 실행은 사람이 확인 버튼을 누른 요청(app/actions/assistant.ts confirmAiAction)만 한다 — 그 요청이
 * ai_action_decide()로 확인을 한 번 소비한 뒤, 돌려받은 줄의 payload를 **기존 쓰기 문**(같은 입력 검사 ·
 * 같은 RLS)으로 실행한다. 이 파일은 실행 코드를 import하지 않는다.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

async function propose(
  ctx: ToolContext,
  kind: AiActionKind,
  payload: Record<string, unknown>,
  preview: AiActionPreview,
  target?: { table: string; id: string; business_id?: string | null },
) {
  const action = await ctx.repo.createAiAction(
    {
      chat_id: ctx.chatId,
      kind,
      payload,
      preview,
      target_table: target?.table ?? null,
      target_id: target?.id ?? null,
      business_id: target?.business_id ?? null,
    },
    { user_id: ctx.user.user_id, role: ctx.user.role },
  )
  ctx.actionIds.push(action.action_id)
  return {
    status: 'awaiting_confirmation',
    action_id: action.action_id,
    kind: AI_ACTION_LABEL_KO[kind],
    preview,
    note: '아직 아무것도 바뀌지 않았다. 화면에 미리보기와 [확인] 버튼이 떴다 — 사용자가 누르면 그때 저장된다. «저장했다»고 말하지 말 것.',
  }
}

/** 제안은 웹 화면에서만(확인 버튼을 누를 자리가 있어야 한다). 카카오는 읽기만. */
const webOnly = (ctx: ToolContext) => ctx.channel === 'web'

/* ---------------------------------------------------------------- 이니셔티브 고치기 */

const TEXT_FIELDS = ['title', 'goal', 'next_action', 'next_action_owner', 'blocker'] as const
const DATE_FIELDS = ['target_date', 'next_action_date'] as const
const FIELD_LABEL: Record<string, string> = {
  title: '제목', goal: '목표', next_action: '다음 행동', next_action_owner: '다음 행동 담당', blocker: '막힌 것',
  target_date: '목표일', next_action_date: '다음 행동 날짜', stage: '단계', status: '상태', kind: '유형',
}

function checkField(field: string, value: string): string | null {
  if ((TEXT_FIELDS as readonly string[]).includes(field)) {
    const max = field === 'goal' ? 2000 : 500
    if (value.length > max) return `${FIELD_LABEL[field]}은(는) ${max}자까지입니다.`
    if (field === 'title' && !value) return '제목은 비울 수 없습니다.'
    return null
  }
  if ((DATE_FIELDS as readonly string[]).includes(field)) return !value || isDate(value) ? null : '날짜는 YYYY-MM-DD입니다.'
  if (field === 'stage') return (INITIATIVE_STAGE as readonly string[]).includes(value) ? null : `단계는 ${INITIATIVE_STAGE.join(' · ')} 중 하나입니다.`
  if (field === 'status') return (INITIATIVE_STATUS as readonly string[]).includes(value) ? null : '상태는 Active · Done · Dropped 중 하나입니다.'
  if (field === 'kind') return (INITIATIVE_KIND as readonly string[]).includes(value) ? null : '알 수 없는 유형입니다.'
  return '고칠 수 없는 칸입니다.'
}

const show = (field: string, v: unknown) =>
  v === null || v === undefined || v === '' ? '(비어 있음)' : field === 'stage' ? INITIATIVE_STAGE_LABEL_KO[v as Initiative['stage']] ?? String(v) : String(v)

export const proposeInitiativeTool: AssistantTool = {
  def: {
    name: 'propose_initiative_update',
    description:
      '이니셔티브 칸을 고치자고 **제안**한다(실행 아님 — 사용자가 확인 버튼을 눌러야 저장). 고칠 수 있는 칸: title · goal · ' +
      'next_action · next_action_owner · next_action_date · target_date · blocker · stage · status · kind. 날짜는 YYYY-MM-DD, ' +
      '빈 문자열은 «비움». 건을 못 찾으면 제안하지 말고 없다고 말한다.',
    input_schema: {
      type: 'object',
      properties: {
        initiative: { type: 'string', description: 'id 또는 제목' },
        changes: { type: 'object', additionalProperties: { type: 'string' }, description: '{칸: 새 값}' },
      },
      required: ['initiative', 'changes'],
    },
  },
  available: (ctx) => webOnly(ctx) && INITIATIVE_ROLES.has(ctx.user.role),
  async run(input, ctx) {
    const { hit, candidates } = await findInitiative(ctx, str(input.initiative))
    if (!hit) return { error: 'not_found', message: `«${str(input.initiative)}» 이니셔티브를 찾지 못했습니다.`, candidates: candidates.map((c) => c.title) }
    const raw = (input.changes && typeof input.changes === 'object' ? input.changes : {}) as Record<string, unknown>
    const changes: Record<string, string> = {}
    for (const [field, v] of Object.entries(raw).slice(0, 10)) {
      const value = typeof v === 'string' ? v.trim() : v === null ? '' : String(v)
      const problem = checkField(field, value)
      if (problem) return { error: 'invalid', field, message: problem }
      if (String(hit[field as keyof Initiative] ?? '') !== value) changes[field] = value
    }
    if (!Object.keys(changes).length) return { error: 'no_change', message: '지금 값과 같아 바꿀 것이 없습니다.' }
    return propose(ctx, 'initiative_update', { initiative_id: hit.initiative_id, changes }, {
      title: `«${hit.title}» 고치기`,
      lines: Object.entries(changes).map(([f, v]) => ({ label: FIELD_LABEL[f] ?? f, before: show(f, hit[f as keyof Initiative]), after: show(f, v) })),
      href: `/initiatives/${hit.initiative_id}`,
    }, { table: 'initiatives', id: hit.initiative_id, business_id: hit.business_id })
  },
}

/* ---------------------------------------------------------------- 일정 추가 */

export const proposeEventTool: AssistantTool = {
  def: {
    name: 'propose_event',
    description: '캘린더 일정 추가를 **제안**한다(확인 버튼을 눌러야 저장). kind: Trip 출장 · Meeting 미팅 · Deadline 마감 · Other.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        starts_on: { type: 'string', description: 'YYYY-MM-DD' },
        ends_on: { type: 'string', description: 'YYYY-MM-DD(여러 날일 때)' },
        kind: { type: 'string', enum: [...EVENT_KIND] },
        initiative: { type: 'string', description: '걸 이니셔티브(id 또는 제목)' },
        business: { type: 'string' },
        location: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['title', 'starts_on', 'kind'],
    },
  },
  // 0017 events_write = Chairman · GroupCFO(이니셔티브와 같은 표 묶음).
  available: (ctx) => webOnly(ctx) && INITIATIVE_ROLES.has(ctx.user.role),
  async run(input, ctx) {
    const title = str(input.title, 500)
    const starts_on = str(input.starts_on)
    const ends_on = str(input.ends_on)
    const kind = str(input.kind)
    if (!title) return { error: 'invalid', message: '제목이 없습니다.' }
    if (!isDate(starts_on)) return { error: 'invalid', message: '시작일은 YYYY-MM-DD입니다.' }
    if (ends_on && (!isDate(ends_on) || ends_on < starts_on)) return { error: 'invalid', message: '종료일을 확인하세요.' }
    if (!(EVENT_KIND as readonly string[]).includes(kind)) return { error: 'invalid', message: '일정 종류를 고르세요.' }
    let initiative: Initiative | null = null
    if (str(input.initiative)) {
      const r = await findInitiative(ctx, str(input.initiative))
      if (!r.hit) return { error: 'not_found', message: `«${str(input.initiative)}» 이니셔티브를 찾지 못했습니다.`, candidates: r.candidates.map((c) => c.title) }
      initiative = r.hit
    }
    const biz = str(input.business) ? resolveBusiness(str(input.business), await ctx.businesses()) : null
    if (str(input.business) && !biz) return { error: 'not_found', message: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const payload = {
      title, starts_on, ends_on, kind,
      initiative_id: initiative?.initiative_id ?? '',
      business_id: biz?.business_id ?? initiative?.business_id ?? '',
      location: str(input.location, 200),
      note: str(input.note, 500),
    }
    return propose(ctx, 'event_create', payload, {
      title: `일정 추가 — ${title}`,
      lines: [
        { label: '날짜', before: null, after: ends_on ? `${starts_on} ~ ${ends_on}` : starts_on },
        { label: '종류', before: null, after: kind },
        ...(initiative ? [{ label: '이니셔티브', before: null, after: initiative.title }] : []),
        ...(biz ? [{ label: '회사', before: null, after: biz.name }] : []),
        ...(payload.location ? [{ label: '장소', before: null, after: payload.location }] : []),
      ],
      href: '/calendar',
    }, initiative ? { table: 'initiatives', id: initiative.initiative_id, business_id: initiative.business_id } : undefined)
  },
}

/* ---------------------------------------------------------------- 결재 기안 */

export const proposeApprovalTool: AssistantTool = {
  def: {
    name: 'propose_approval_draft',
    description:
      '결재 기안 초안을 **제안**한다(확인 버튼을 눌러야 올라간다). 선택안(options)은 둘 이상 권장 — 고를 것이 없으면 결재가 아니다. ' +
      'AI는 어느 선택안을 고를지 정하지 않는다. impact: Critical · High · Medium · Low.',
    input_schema: {
      type: 'object',
      properties: {
        business: { type: 'string' },
        title: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        impact: { type: 'string', enum: [...WORK_PRIORITY] },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['business', 'title', 'options', 'impact', 'deadline'],
    },
  },
  available: webOnly,
  async run(input, ctx) {
    const biz = resolveBusiness(str(input.business), await ctx.businesses())
    if (!biz) return { error: 'not_found', message: `회사를 찾지 못했습니다: «${str(input.business)}»` }
    const title = str(input.title, 300)
    const options = strList(input.options, 10).map((o) => o.slice(0, 300))
    const impact = str(input.impact)
    const deadline = str(input.deadline)
    if (!title) return { error: 'invalid', message: '제목이 없습니다.' }
    if (!options.length) return { error: 'invalid', message: '선택안이 없습니다 — 고를 것이 없으면 결재가 아닙니다.' }
    if (!(WORK_PRIORITY as readonly string[]).includes(impact)) return { error: 'invalid', message: '긴급도를 고르세요.' }
    if (!isDate(deadline) || deadline < kstToday()) return { error: 'invalid', message: '마감일은 오늘 이후 YYYY-MM-DD입니다.' }
    return propose(ctx, 'approval_draft', { business_id: biz.business_id, title, options, impact, deadline }, {
      title: `결재 기안 — ${title}`,
      lines: [
        { label: '회사', before: null, after: biz.name },
        { label: '선택안', before: null, after: options.map((o, i) => `${i + 1}. ${o}`).join('\n') },
        { label: '긴급도 · 마감', before: null, after: `${impact} · ${deadline}` },
      ],
      warning: '기안만 올립니다. 승인 · 반려는 결재선이 정합니다(AI는 결정하지 않습니다).',
      href: '/approvals',
    }, { table: 'businesses', id: biz.business_id, business_id: biz.business_id })
  },
}

/* ---------------------------------------------------------------- 체크인 */

export const proposeCheckinTool: AssistantTool = {
  def: {
    name: 'propose_checkin',
    description: '회장 전용: 오늘(또는 date) 체크인 기록을 **제안**한다. condition 1~5, sleep_hours 0~24, weight_kg, meal_note.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        condition: { type: 'integer', minimum: 1, maximum: 5 },
        sleep_hours: { type: 'number' },
        weight_kg: { type: 'number' },
        meal_note: { type: 'string' },
      },
      required: ['condition'],
    },
  },
  available: (ctx) => webOnly(ctx) && ctx.user.role === 'Chairman',
  async run(input, ctx) {
    const date = isDate(str(input.date)) ? str(input.date) : kstToday()
    const condition = Number(input.condition)
    if (!Number.isInteger(condition) || condition < 1 || condition > 5) return { error: 'invalid', message: '컨디션은 1~5입니다.' }
    const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
    const sleep = num(input.sleep_hours)
    const weight = num(input.weight_kg)
    if (sleep !== null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) return { error: 'invalid', message: '수면은 0~24시간입니다.' }
    if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 300)) return { error: 'invalid', message: '체중을 확인하세요.' }
    const meal = str(input.meal_note, MEAL_MAX)
    const before = await ctx.repo.getCheckin(date).catch(() => null)
    return propose(ctx, 'checkin', { checkinDate: date, condition, sleepHours: sleep, weightKg: weight, mealNote: meal }, {
      title: `${date} 체크인`,
      lines: [
        { label: '컨디션', before: before ? String(before.condition) : null, after: String(condition) },
        ...(sleep !== null ? [{ label: '수면', before: before?.sleep_hours != null ? `${before.sleep_hours}시간` : null, after: `${sleep}시간` }] : []),
        ...(weight !== null ? [{ label: '체중', before: before?.weight_kg != null ? `${before.weight_kg}kg` : null, after: `${weight}kg` }] : []),
        ...(meal ? [{ label: '식사', before: before?.meal_note || null, after: meal }] : []),
      ],
      href: '/ai',
    })
  },
}

/* ---------------------------------------------------------------- 메모 정리 */

export const proposeMemoTool: AssistantTool = {
  def: {
    name: 'propose_memo_tidy',
    description: '회장 전용: 이니셔티브의 회장 메모를 AI로 정리한 안을 **제안**한다(확인해야 메모가 바뀐다).',
    input_schema: { type: 'object', properties: { initiative: { type: 'string' } }, required: ['initiative'] },
  },
  available: (ctx) => webOnly(ctx) && ctx.user.role === 'Chairman',
  async run(input, ctx) {
    const { hit, candidates } = await findInitiative(ctx, str(input.initiative))
    if (!hit) return { error: 'not_found', message: `«${str(input.initiative)}» 이니셔티브를 찾지 못했습니다.`, candidates: candidates.map((c) => c.title) }
    const memo = (await ctx.repo.getInitiativeNote(hit.initiative_id)) ?? ''
    if (!memo.trim()) return { error: 'empty', message: '정리할 메모가 없습니다.' }
    const tidy = await structureMemo(ctx.repo, hit.initiative_id, memo)
    if (!tidy.text) return { error: 'failed', message: tidy.error ?? '정리하지 못했습니다.' }
    return propose(ctx, 'memo_tidy', { initiative_id: hit.initiative_id, note: tidy.text }, {
      title: `«${hit.title}» 회장 메모 정리`,
      lines: [{ label: '메모', before: memo.slice(0, 1500), after: tidy.text.slice(0, 3000) }],
      warning: tidy.dummy ? '[DUMMY] 키가 없어 실제 정리가 아닙니다.' : null,
      href: `/initiatives/${hit.initiative_id}`,
    }, { table: 'initiatives', id: hit.initiative_id, business_id: hit.business_id })
  },
}

/* ---------------------------------------------------------------- 첨부 요약 요청 */

export const proposeSummaryTool: AssistantTool = {
  def: {
    name: 'propose_attachment_summary',
    description: '첨부 파일 하나의 AI 요약(다시 요약) 실행을 **제안**한다 — 파일이 외부 AI로 나가므로 확인이 필요하다. Vault는 안 된다.',
    input_schema: { type: 'object', properties: { attachment_id: { type: 'string' } }, required: ['attachment_id'] },
  },
  available: webOnly,
  async run(input, ctx) {
    const a = await ctx.repo.getAttachment(str(input.attachment_id, 64)).catch(() => null)
    if (!a) return { error: 'not_found', message: '첨부를 찾지 못했습니다(없거나 볼 권한이 없습니다).' }
    if (a.security_class === 'Vault') return { error: 'vault', message: 'Vault 첨부는 AI로 보내지 않습니다.' }
    return propose(ctx, 'attachment_summary', { attachment_id: a.attachment_id }, {
      title: `첨부 요약 — ${a.file_name}`,
      lines: [{ label: '파일', before: `요약 상태: ${a.status}`, after: `${a.file_name} (${Math.max(1, Math.round(a.size_bytes / 1024)).toLocaleString('ko-KR')}KB · ${a.security_class})` }],
      warning: '확인하면 이 파일의 본문이 외부 AI(Anthropic)로 전송되고 감사에 남습니다.',
    }, { table: a.entity_table, id: a.entity_id, business_id: a.business_id })
  },
}
