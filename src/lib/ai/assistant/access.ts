import 'server-only'

import { isChairman } from '@/lib/boss'
import type { PersonAccess, Role } from '@/types'

import { addEvidence, norm, str, type AssistantTool, type ToolContext } from './kit'

/**
 * 0069 권한 · 조직 조회(회장 결정 2, 2026-10-12). 읽기만 — 바꾸기는 /settings/users(대표).
 *
 * ■ 왜 ■ «김병훈 사원의 권한은?»이 «이름과 id만 조회되고 권한은 볼 수 없습니다»로 끝났다(2026-10-12 실사용).
 *   org_lookup은 이름 · id만 주고, 남의 모듈 줄은 0002가 본인 · 대표에게만 연다.
 * ■ 범위는 DB가 정한다 ■ org_access_lookup(0069): 대표 전원 · 본인 · 사용자 관리자는 맡은 회사의 사원 · 팀장.
 *   원가 4종 줄은 대표 세션에만 온다 — 여기서는 그 결과를 표로 옮길 뿐, 범위를 다시 판정하지 않는다.
 * ■ 원가 ■ 대표가 아니면 원가 4종 칸을 한 줄 «원가 관련 권한은 대표에게 문의»로 바꾼다(본인 것도). BOM · 원가 숫자는 없다.
 */

/** 앱 주소(보고 · 답의 «바꾸는 화면» 링크). 배포 주소가 바뀌면 env로. */
export const APP_ORIGIN = (process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://chairman-os-eosin.vercel.app').replace(/\/$/, '')

export const USERS_SCREEN_PATH = '/settings/users'

export function personHref(userId: string): string {
  return `${USERS_SCREEN_PATH}?person=${encodeURIComponent(userId)}`
}

type Cover = readonly Role[]

/** 회장 결정 2의 모듈 권한 열 — 순서 그대로. key = 모듈 접두사, field = 칸. */
interface GrantSpec {
  label: string
  prefix: string
  field: 'can_write' | 'can_approve' | 'row'
  /** 역할로 이미 되는 사람(MODULE_GRANT_OPTIONS.roleCovers · 0002/0047과 같은 판정). */
  covers: Cover
  /** 회사가 키에 없는 전역 줄인가('/chairman/decisions'). */
  global?: boolean
  cost?: boolean
}

export const GRANT_SPECS: GrantSpec[] = [
  { label: '결재 올리기', prefix: '/chairman/decisions', field: 'can_write', covers: ['Chairman'], global: true },
  { label: '사용자 관리자', prefix: '/users', field: 'can_write', covers: [] },
  { label: '재무 입력', prefix: '/finance', field: 'can_write', covers: ['Chairman', 'GroupCFO'] },
  { label: '월 마감', prefix: '/finance', field: 'can_approve', covers: ['Chairman', 'GroupCFO'] },
  { label: '문서 등록', prefix: '/documents', field: 'can_write', covers: ['Chairman'] },
  { label: '결재 대장 열람', prefix: '/approvals/ledger', field: 'row', covers: ['Chairman'] },
  { label: '구매', prefix: '/purchasing', field: 'row', covers: ['Chairman'], cost: true },
  { label: '생산', prefix: '/production', field: 'row', covers: ['Chairman'], cost: true },
  { label: '영업', prefix: '/sales', field: 'row', covers: ['Chairman'], cost: true },
  { label: '원가 관리', prefix: '/costing', field: 'row', covers: ['Chairman'], cost: true },
]

const COST_WRITE_LABEL: Record<string, string> = {
  '/purchasing': '구매 입력',
  '/production': '생산 입력',
  '/sales': '영업 견적',
  '/costing': '원가 관리',
}

export const COST_ASK_LINE = '원가 관련 권한은 대표에게 문의'

export interface GrantRow {
  label: string
  value: string
}

/** 사람 한 명의 권한 표(글자). viewerChair가 아니면 원가 4종은 한 줄로. */
export function grantRows(p: PersonAccess, viewerChair: boolean, bizName: (id: string) => string): GrantRow[] {
  const rows: GrantRow[] = []
  let costAsked = false
  for (const spec of GRANT_SPECS) {
    if (spec.cost && !viewerChair) {
      if (!costAsked) rows.push({ label: '원가 관련', value: COST_ASK_LINE })
      costAsked = true
      continue
    }
    if (spec.covers.includes(p.role)) {
      rows.push({ label: spec.label, value: '있음(역할로 전 회사)' })
      continue
    }
    if (spec.prefix === '/users' && p.role === 'Chairman') {
      rows.push({ label: spec.label, value: '있음(대표 — 전 범위 초대)' })
      continue
    }
    if (spec.global) {
      const g = p.modules.find((m) => m.module === spec.prefix)
      rows.push({ label: spec.label, value: g?.can_write ? '있음' : '없음' })
      continue
    }
    const hits = p.modules.filter((m) => m.module.startsWith(`${spec.prefix}/`) && m.module.split('/').length === spec.prefix.split('/').length + 1)
    const on = hits.filter((m) => (spec.field === 'row' ? true : m[spec.field]))
    if (!on.length) {
      rows.push({ label: spec.label, value: '없음' })
      continue
    }
    const parts = on.map((m) => {
      const biz = bizName(m.module.slice(spec.prefix.length + 1))
      if (spec.cost) return `${biz} ${m.can_write ? COST_WRITE_LABEL[spec.prefix] : '보기만'}`
      return biz
    })
    rows.push({ label: spec.label, value: `있음(${parts.join(', ')})` })
  }
  return rows
}

const ROLE_KO: Record<string, string> = {
  Chairman: '대표',
  GroupCFO: '그룹 CFO',
  BusinessCEO: '회사 대표',
  Executive: '임원',
  TeamLead: '팀장',
  Member: '사원',
  AIAgent: '시스템 계정',
  Integration: '시스템 계정',
}

const STATUS_KO: Record<string, string> = { active: '재직', left: '퇴사', leave: '휴직', pending: '입사 전' }

export function roleKo(role: string, viewer: Role): string {
  if (role === 'Chairman') return isChairman(viewer) ? '회장' : '대표'
  return ROLE_KO[role] ?? role
}

export function bossLine(p: PersonAccess, viewer: Role): string {
  const r = p.reports_to
  if (!r) return p.role === 'Chairman' ? '없음(맨 위)' : '없음(미지정)'
  if ('top' in r) return '대표'
  if (r.role === 'Chairman') return isChairman(viewer) ? `${r.name}(회장)` : '대표'
  return `${r.name}(${r.title || roleKo(r.role, viewer)})`
}

export function scopeLine(p: PersonAccess, bizName: (id: string) => string): string {
  if (p.businesses.includes('*')) return '전 회사(전사 역할)'
  return p.businesses.length ? p.businesses.map(bizName).join(', ') : '없음'
}

/** 모델에게 주는 한 사람(표 그대로 · 바꾸는 화면). */
export function accessForModel(p: PersonAccess, viewer: Role, bizName: (id: string) => string) {
  const chair = isChairman(viewer)
  return {
    name: p.name,
    title: p.title,
    role: roleKo(p.role, viewer),
    status: STATUS_KO[p.status] ?? p.status,
    revoked: p.revoked,
    self: p.self,
    team: p.team?.name ?? '미배정',
    boss: bossLine(p, viewer),
    company_scope: scopeLine(p, bizName),
    permissions: grantRows(p, chair, bizName),
    change_at: chair ? `${APP_ORIGIN}${personHref(p.user_id)} → 조직도 → ${p.name}` : '권한을 바꾸려면 대표에게 요청(대표가 사용자 화면 조직도에서 바꿉니다)',
  }
}

export const accessTool: AssistantTool = {
  def: {
    name: 'person_access',
    description:
      '권한 · 조직 조회(읽기만): 사람 이름 · 팀 이름(«영업팀») · "me"(묻는 사람 본인)로 역할 · 직함 · 팀 · 직속 상사 · 회사 범위 · ' +
      '모듈 권한(결재 올리기 · 사용자 관리자 · 재무 입력 · 월 마감 · 문서 등록 · 결재 대장 열람 · 원가 4종) · 상태를 준다. ' +
      '보이는 사람만 온다(DB가 자른다). 바꾸지는 못한다 — 바꾸는 곳은 결과의 change_at.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: '이름 · 팀 이름 · "me"' } }, required: ['query'] },
  },
  available: (ctx) => ctx.channel === 'web',
  async run(input, ctx) {
    const q = str(input.query, 60) || 'me'
    const people = await ctx.repo.orgAccessLookup(q)
    if (people === null) {
      return { error: 'not_ready', message: '권한 조회가 아직 이 환경에 없습니다 — 사용자 화면(조직도)에서 그 사람을 열어 보세요.', where: `${APP_ORIGIN}${USERS_SCREEN_PATH}` }
    }
    const names = new Map((await ctx.businesses()).map((b) => [b.business_id, b.name]))
    const bizName = (id: string) => names.get(id) ?? id.replace(/^biz_/, '').toUpperCase()
    for (const p of people.slice(0, 3)) {
      addEvidence(ctx, { label: `${p.name} · 권한`, href: personHref(p.user_id), detail: '사용자 · 권한 · 조직도' })
    }
    if (!people.length) {
      return {
        found: 0,
        scope_note: isChairman(ctx.user.role)
          ? '그 이름의 사람이 없습니다.'
          : '본인 것만(사용자 관리자는 맡은 회사의 사원 · 팀장까지) 볼 수 있습니다 — 다른 사람의 권한은 대표에게 문의하세요.',
      }
    }
    return { found: people.length, people: people.map((p) => accessForModel(p, ctx.user.role, bizName)) }
  },
}

/* ───────── 모델 앞 규칙: «X 권한은?» — 코드가 표로 답한다 ───────── */

/** «김병훈 권한은?» · «김병훈 사원의 권한 알려줘» · «내 권한은?» → 대상 말(이름 · 'me'). 아니면 null. */
export function accessTarget(q: string): string | null {
  const t = q.trim().replace(/[?？.!]+$/, '')
  if (t.length > 40) return null
  const m = /^(.{1,24}?)\s*(?:의|은|는)?\s*(?:권한|권한이|권한은|권한을)\s*(?:은|는|이|이요|좀|뭐야|뭐예요|뭐에요|어때|알려\s*줘|알려\s*주세요|보여\s*줘|확인)?\s*(?:뭐야|뭐예요|알려\s*줘)?$/.exec(t)
  if (!m) return null
  // «김병훈 사원» · «김병훈님» → 김병훈. 띄어 쓴 직함만 뗀다(«경영지원팀장»은 그 자체가 이름).
  const who = m[1].trim().replace(/\s+(사원|팀장|대리|과장|차장|부장|본부장|이사|대표)$/, '').replace(/(님|씨)$/, '').trim()
  if (/^(내|나|저|제|나의|저의|본인|내\s*계정)$/.test(who)) return 'me'
  // «결재 권한» · «원가 관리 권한»처럼 사람이 아니라 권한 종류를 묻는 말은 모델로(이름에 «영업» 등이 든 «영업 직원»은 사람이다).
  if (/^(결재|결재 올리기|재무|재무 입력|문서|문서 등록|원가|원가 관리|구매|생산|영업|마감|월 마감|관리|관리자|사용자 관리|사용자 관리자|결재 대장)(\s*관련)?$/.test(who)) return null
  if (/누가|어떤|무슨|모든|전체|팀원들|사람들/.test(who)) return null
  return norm(who).length >= 2 ? who : null
}

export interface AccessAnswer {
  answer: string
  people: PersonAccess[]
}

/** 코드가 짓는 답 — 의도 한 줄 · 사람 칸 · 권한 표 · 바꾸는 곳. 못 찾으면 왜 · 어디서 · 대신 할 수 있는 것. */
export function composeAccessAnswer(target: string, people: PersonAccess[] | null, viewer: Role, bizName: (id: string) => string): string {
  const chair = isChairman(viewer)
  const me = target === 'me'
  const intent = me ? '내 권한 · 팀 · 상사를 보시려는 것으로 이해했습니다.' : `${target}의 권한 · 팀 · 상사를 보시려는 것으로 이해했습니다.`
  if (people === null) {
    return [
      intent,
      '이 환경에는 아직 권한 조회(0069)가 없어 표를 만들지 못했습니다.',
      chair ? `어디서: ${APP_ORIGIN}${USERS_SCREEN_PATH} → 조직도 → 그 사람을 누르면 권한 칸이 보입니다.` : '어디서: 대표에게 요청하시면 사용자 화면에서 확인해 드립니다.',
      '대신: 이름으로 팀 목록은 지금도 찾아 드릴 수 있습니다.',
    ].join('\n')
  }
  if (!people.length) {
    return chair
      ? [intent, `«${target}»이라는 사람을 찾지 못했습니다.`, `어디서: ${APP_ORIGIN}${USERS_SCREEN_PATH} → 조직도에서 이름을 확인해 보세요.`, '대신: 성만, 또는 팀 이름(예: 영업팀)으로 다시 물어 주세요.'].join('\n')
      : [
          intent,
          '다른 사람의 권한은 볼 수 없습니다 — 본인 것만(사용자 관리자는 맡은 회사의 사원 · 팀장까지) 보입니다.',
          '어디서: 그 사람의 권한은 대표에게 문의하세요(대표가 사용자 화면 조직도에서 봅니다).',
          '대신: «내 권한은?»으로 본인 권한은 바로 보여 드립니다.',
        ].join('\n')
  }
  const blocks = people.slice(0, 3).map((p) => {
    const rk = roleKo(p.role, viewer)
    const head = `${p.name} — ${p.title && p.title !== rk ? `${p.title}(${rk})` : rk} · ${STATUS_KO[p.status] ?? p.status}${p.revoked ? ' · 권한 회수됨' : ''}`
    const lines = [
      head,
      `팀: ${p.team?.name ?? '미배정'}`,
      `직속 상사: ${bossLine(p, viewer)}`,
      `회사 범위: ${scopeLine(p, bizName)}`,
      '권한:',
      ...grantRows(p, chair, bizName).map((r) => `· ${r.label} — ${r.value}`),
    ]
    lines.push(
      chair
        ? `바꾸려면: ${APP_ORIGIN}${personHref(p.user_id)} → 조직도 → ${p.name}`
        : '바꾸려면: 대표에게 요청하세요(대표가 사용자 화면 조직도에서 바꿉니다).',
    )
    return lines.join('\n')
  })
  const more = people.length > 3 ? `\n같은 이름으로 ${people.length}명이 걸려 앞의 3명만 보였습니다 — 팀이나 직함을 붙여 다시 물어 주세요.` : ''
  return `${intent}\n\n${blocks.join('\n\n')}${more}`
}

export async function runAccessRule(target: string, ctx: ToolContext): Promise<{ answer: string; people: PersonAccess[] }> {
  const people = await ctx.repo.orgAccessLookup(target).catch((e) => {
    console.error('[assistant] org_access_lookup', e)
    return null
  })
  const names = new Map((await ctx.businesses()).map((b) => [b.business_id, b.name]))
  const bizName = (id: string) => names.get(id) ?? id.replace(/^biz_/, '').toUpperCase()
  for (const p of (people ?? []).slice(0, 3)) {
    addEvidence(ctx, { label: `${p.name} · 권한 바꾸는 곳`, href: personHref(p.user_id), detail: isChairman(ctx.user.role) ? '조직도에서 그 사람' : '사용자 · 권한 · 조직도' })
  }
  if (people === null || (people.length === 0 && isChairman(ctx.user.role))) addEvidence(ctx, { label: '사용자 · 권한 · 조직도', href: USERS_SCREEN_PATH })
  return { answer: composeAccessAnswer(target, people, ctx.user.role, bizName), people: people ?? [] }
}
