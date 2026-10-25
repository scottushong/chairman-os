import 'server-only'

import { eaDocHref, eaTodoHref, myApprovalPendingCount, myApprovalPendingList, mySubmittedApprovals } from '@/lib/approvals/widget'
import { eaStore } from '@/lib/approvals/store'
import { DOC_STATUS_LABEL, shortDate, type EaListRow } from '@/lib/approvals/types'
import { showsCostsNav, showsProductionNav, showsPurchasingNav, showsSalesNav } from '@/lib/auth/roles'
import { bossText } from '@/lib/boss'
import { kstToday } from '@/lib/chairman-project'
import { DATA_MODE } from '@/lib/env'
import { navFor } from '@/lib/nav'
import { getRepository } from '@/lib/repository'
import { loadSidebarData } from '@/lib/sidebar-data'
import { CALENDAR_ITEM_LABEL_KO, TASK_STATUS_LABEL_KO, type SessionUser, type Task } from '@/types'

import { canSeeInvestment } from '@/lib/investment/screen-rules'

import { audienceOf, pickMyTasks, pickRequested, weekEnd, widgetDef, WIDGETS, type FavoriteOption, type Tone, type WidgetData, type WidgetItem } from './widgets'

/**
 * 0086 «내 홈» 위젯 내용 — 위젯마다 **기존 기능의 조회 · 기존 권한** 그대로 부른다(위젯을 더한다고 볼 수 있는 것이 늘지 않는다).
 *   내 업무      repo.listTasks()(0002 RLS) → 내가 맡은 열린 업무.
 *   전자결재      lib/approvals/widget.ts(0087 ea_counts · ea_list — 메뉴와 같은 함수). 건수 = «결재할 문서» 탭 숫자.
 *   일정          repo.listCalendarItems()(0017 calendar_items — /calendar와 같은 뷰).
 *   요청한 업무   repo.listDecisions()(내가 올린 결재 요청 — /me «내 요청»과 같은 줄). 업무(tasks)에는 요청자 칸이 없다.
 *   공지          repo.listNotices()(0038 — 회사 · 그룹 공지, 읽음은 내 줄).
 *   최근 문서     repo.listDocuments()(0002 · 0048 RLS) → 일반 · 공개 등급만.
 *   설비 요청     내가 올린 전자결재 중 «설비수리 품의»만.
 *   근태 · 휴가   이 시스템에 없다 → «연동 준비 중»(예시를 지어내지 않는다).
 * 목록과 건수는 같은 조건으로 센다(지시문 4절 끝). 결재 금액 · 재무 숫자는 싣지 않는다.
 * 한 위젯이 실패해도 다른 위젯은 선다 — 위젯마다 따로 부르고(서버 액션), 실패는 그 위젯의 «다시 시도»로.
 *
 * 0097: 프로젝트 현황(repo.listProjects — 0027 RLS) · 데이터 범위(구역 · 위젯 scope — 회사 · 프로젝트)를 더했다. 범위는 보여 줄 것을
 * 좁힐 뿐이다(읽기는 위 조회 그대로). 대표 첫 화면 전용 위젯(재무 · 투자 · 아침 루틴 판단 · 기억 검토함)은 여기 없다 —
 * lib/dashboard/widgets.ts가 그 기능의 문을 지난 뒤에만 읽는다.
 */

const LIST_MAX = 5

export interface HomeAccess {
  home: boolean
  approvals: boolean
  /** 0097 — 대표 · 그룹 CFO(재무 위젯). */
  top?: boolean
  /** 0097 — 대표만(아침 루틴 판단 · 준비 중 칸). */
  chair?: boolean
  /** 0097 — 대표 · «/investment» 지정자 + 스위치 investment. */
  investment?: boolean
  /** 0097 — 대표 + 스위치 memory_engine. */
  memory?: boolean
}

/** 이 사람에게 «내 홈» · 전자결재가 켜져 있나 — 그룹 줄 또는 내가 볼 수 있는 회사 줄 하나라도(사이드바 메뉴와 같은 판정). */
export async function homeAccess(user: SessionUser | null): Promise<HomeAccess> {
  if (!user) return { home: false, approvals: false }
  const hidden = (await loadSidebarData(user.role)).hiddenNav
  const human = user.role !== 'AIAgent' && user.role !== 'Integration'
  const chair = human && user.role === 'Chairman'
  return {
    home: !hidden.includes('nav_home'),
    approvals: !hidden.includes('nav_eapproval'),
    top: chair || (human && user.role === 'GroupCFO'),
    chair,
    investment: human && !hidden.includes('nav_investment') && canSeeInvestment(user),
    memory: chair && !hidden.includes('nav_memory'),
  }
}

/** 0097 — 이 위젯을 넣을 수 있나(라이브러리 «추가» · 서버 저장 · API가 같은 판정). 준비 중(listOnly)은 넣을 수 없다. DB home_kind_allowed가 한 번 더 본다. */
export function kindAllowed(access: HomeAccess, kind: string): boolean {
  const def = widgetDef(kind)
  if (!def) return true // 모르는 종류(없어진 위젯)는 배치에서 지우지 않는다 — 그리지 않을 뿐.
  if (def.listOnly) return false
  if (def.needsApprovals && !access.approvals) return false
  if (def.kind === 'memory_review' && !access.memory) return false
  const a = audienceOf(def)
  return a === 'all' ? true : a === 'top' ? !!access.top : a === 'chair' ? !!access.chair : !!access.investment
}

/** 0097 — 라이브러리에 보일 위젯(넣을 수 있는 것 + 이 사람에게 해당하는 «준비 중»). 직원에게는 재무 · 투자 위젯이 목록에도 없다. */
export function libraryKinds(access: HomeAccess): string[] {
  return WIDGETS.filter((w) => {
    const a = audienceOf(w)
    const mine = a === 'all' || (a === 'top' && access.top) || (a === 'chair' && access.chair) || (a === 'invest' && access.investment)
    if (!mine) return false
    return w.listOnly ? true : kindAllowed(access, w.kind)
  }).map((w) => w.kind)
}

/** 0097 위젯 데이터 범위(서버가 이미 «볼 수 있는 회사 · 프로젝트»인지 본 값). */
export interface DataScope {
  biz: string
  project: string | null
}
const ALL: DataScope = { biz: 'all', project: null }

const md = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : '')

function taskItem(t: Task, today: string): WidgetItem {
  const badge: { text: string; tone: Tone } =
    t.deadline && t.deadline < today ? { text: '기한 지남', tone: 'red' } : t.deadline === today ? { text: '오늘 마감', tone: 'orange' } : { text: TASK_STATUS_LABEL_KO[t.status], tone: 'blue' }
  return {
    id: t.task_id,
    title: t.title,
    href: `/tasks/${encodeURIComponent(t.task_id)}`,
    badge,
    meta: [t.source_label, badge.text !== TASK_STATUS_LABEL_KO[t.status] ? TASK_STATUS_LABEL_KO[t.status] : null].filter(Boolean).join(' · ') || undefined,
    right: t.deadline ? `${md(t.deadline)} 마감` : '마감 없음',
    example: t.is_example || undefined,
  }
}

const DECISION_STATE: Record<string, { text: string; tone: Tone }> = {
  Open: { text: '처리 중', tone: 'blue' },
  Approved: { text: '승인', tone: 'green' },
  Rejected: { text: '반려', tone: 'red' },
  Modified: { text: '수정 요청', tone: 'orange' },
  Delegated: { text: '위임', tone: 'gray' },
}

function eaItem(r: EaListRow, box: 'todo' | 'mine'): WidgetItem {
  return {
    id: r.doc_id,
    title: r.title,
    href: eaDocHref(box, r.doc_id),
    badge: box === 'todo' ? (r.overdue ? { text: '기한 지남', tone: 'orange' } : { text: '결재 대기', tone: 'blue' }) : { text: DOC_STATUS_LABEL[r.status], tone: r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'in_progress' ? 'blue' : 'gray' },
    // 기안자 · 지금 단계 — 금액은 싣지 않는다.
    meta: box === 'todo' ? `${r.drafter_name}${r.drafter_dept ? ` · ${r.drafter_dept}` : ''} · ${r.current_label}` : `${r.form_name} · ${r.current_label}`,
    right: shortDate(r.submitted_at ?? r.updated_at),
  }
}

/** 위젯 하나의 내용. kind · filter는 서버 액션이 카탈로그로 먼저 거른다. */
export async function widgetData(user: SessionUser, access: HomeAccess, kind: string, filter: string | undefined, scope: DataScope = ALL): Promise<WidgetData> {
  const def = widgetDef(kind)
  if (!def) return { state: 'error', text: '알 수 없는 위젯입니다.' }
  if (audienceOf(def) !== 'all') return { state: 'denied', text: '이 화면에서 쓸 수 없는 위젯입니다.' }
  const inBiz = (b: string | null | undefined) => scope.biz === 'all' || b === scope.biz
  if (def.needsApprovals && !access.approvals) return { state: 'denied', text: '전자결재를 쓸 수 없는 계정입니다(회사에서 켜면 보입니다).' }
  const today = kstToday()
  const repo = await getRepository()
  try {
    // dummy 시험 손잡이 — DUMMY_HOME_WIDGET_FAIL=<kind>면 그 위젯 조회만 실패한다(«한 위젯 실패가 홈을 막지 않는다» 확인용). live에는 없다.
    if (DATA_MODE === 'dummy' && process.env.DUMMY_HOME_WIDGET_FAIL === kind) throw new Error('dummy 위젯 실패(시험)')
    switch (kind) {
      case 'my_tasks': {
        const scoped = scope.biz !== 'all' || scope.project
        const projectBiz = scoped ? new Map((await repo.listProjects()).map((p) => [p.project_id, p.business_id])) : null
        const rows = pickMyTasks(await repo.listTasks(), user.user_id, today, filter ?? 'open').filter((t) =>
          !projectBiz ? true : scope.project ? t.project_id === scope.project : inBiz(projectBiz.get(t.project_id)),
        )
        return { state: 'ok', count: rows.length, items: rows.slice(0, LIST_MAX).map((t) => taskItem(t, today)) }
      }
      case 'approvals': {
        if (filter === 'mine') {
          const rows = await mySubmittedApprovals(500)
          if (rows === null) return { state: 'error', text: '전자결재를 불러오지 못했습니다.' }
          return { state: 'ok', count: rows.length, items: rows.slice(0, LIST_MAX).map((r) => eaItem(r, 'mine')) }
        }
        const [count, rows] = await Promise.all([myApprovalPendingCount(), myApprovalPendingList(LIST_MAX)])
        if (count === null || rows === null) return { state: 'error', text: '전자결재를 불러오지 못했습니다.' }
        return { state: 'ok', count, items: rows.map((r) => eaItem(r, 'todo')), links: [{ href: eaTodoHref, label: '결재할 문서 전체' }] }
      }
      case 'schedule': {
        const to = filter === 'week' ? weekEnd(today) : today
        const rows = (await repo.listCalendarItems(today as never, to as never))
          .filter((c) => scope.biz === 'all' || c.business_id === scope.biz)
          .sort((a, b) => a.on_date.localeCompare(b.on_date) || a.title.localeCompare(b.title))
        return {
          state: 'ok',
          count: rows.length,
          items: rows.slice(0, LIST_MAX).map((c) => ({
            id: `${c.kind}:${c.source_id}`,
            title: c.title,
            href: c.href,
            badge: { text: c.on_date <= today ? '오늘' : md(c.on_date), tone: 'blue' as Tone },
            meta: CALENDAR_ITEM_LABEL_KO[c.kind],
            right: c.ends_on && c.ends_on !== c.on_date ? `~${md(c.ends_on)}` : undefined,
          })),
          note: '시간 · 장소 · 내 일정/부서 일정 나누기는 연동 준비 중입니다.',
        }
      }
      case 'requested': {
        const rows = pickRequested(await repo.listDecisions(), user.user_id, filter ?? 'open').filter((d) => inBiz(d.business_id))
        return {
          state: 'ok',
          count: rows.length,
          items: rows.slice(0, LIST_MAX).map((d) => {
            const now = d.approval_line?.find((s) => s.user_id) ?? d.approval_line?.[0]
            return {
              id: d.decision_id,
              title: bossText(d.title, user.role),
              href: `/approvals?id=${encodeURIComponent(d.decision_id)}`,
              badge: DECISION_STATE[d.status] ?? { text: d.status, tone: 'gray' as Tone },
              meta: now ? `담당 ${bossText(now.name, user.role)}` : undefined,
              right: d.deadline ? `${md(d.deadline)} 마감` : undefined,
              example: d.is_example || undefined,
            }
          }),
          note: '업무 관리의 «요청자»는 아직 없어 결재 요청만 보입니다.',
        }
      }
      case 'notices': {
        const rows = (await repo.listNotices(user.user_id))
          .filter((n) => !n.expires_on || n.expires_on >= today)
          .filter((n) => (filter === 'unread' ? !n.read_by_me : true))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
        return {
          state: 'ok',
          count: rows.length,
          items: rows.slice(0, LIST_MAX).map((n) => ({
            id: String(n.notice_id),
            title: n.title,
            href: '/groupware',
            badge: n.pinned ? { text: '필독', tone: 'orange' as Tone } : n.read_by_me ? { text: '읽음', tone: 'gray' as Tone } : { text: '안 읽음', tone: 'blue' as Tone },
            meta: n.created_by_name,
            right: md(n.created_at.slice(0, 10)),
          })),
          note: '부서 단위 공지는 연동 준비 중입니다(지금은 회사 · 그룹 공지).',
        }
      }
      case 'recent_docs': {
        const rows = (await repo.listDocuments())
          .filter((d) => d.security_class === 'Public' || d.security_class === 'Normal')
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
        return {
          state: 'ok',
          count: rows.length,
          items: rows.slice(0, LIST_MAX).map((d) => ({
            id: d.document_id,
            title: d.title,
            href: `/documents/${encodeURIComponent(d.document_id)}`,
            meta: `${d.uploaded_by}${d.doc_type ? ` · ${d.doc_type}` : ''}`,
            right: md(d.created_at.slice(0, 10)),
          })),
        }
      }
      case 'facility': {
        const rows = await mySubmittedApprovals(500)
        if (rows === null) return { state: 'error', text: '전자결재를 불러오지 못했습니다.' }
        const mine = rows.filter((r) => r.form_key === 'repair')
        return {
          state: 'ok',
          count: mine.length,
          items: mine.slice(0, LIST_MAX).map((r) => eaItem(r, 'mine')),
          note: '설비 대장 · 위치 · 조치 기한은 연동 준비 중입니다.',
          links: [{ href: '/e-approval?box=drafts&new=repair', label: '설비수리 품의 쓰기' }],
        }
      }
      case 'projects': {
        const [projects, businesses] = await Promise.all([repo.listProjects(), repo.listBusinesses()])
        const bizName = new Map(businesses.map((b) => [b.business_id, b.name]))
        const rows = projects
          .filter((p) => (scope.project ? p.project_id === scope.project : inBiz(p.business_id)))
          .filter((p) => (filter === 'all' ? true : p.status !== 'Done'))
          .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.name.localeCompare(b.name))
        return {
          state: 'ok',
          count: rows.length,
          items: rows.slice(0, LIST_MAX).map((p) => ({
            id: p.project_id,
            title: p.name,
            href: `/projects/${encodeURIComponent(p.project_id)}`,
            badge: p.deadline && p.deadline < today && p.status !== 'Done' ? { text: '기한 지남', tone: 'red' as Tone } : { text: TASK_STATUS_LABEL_KO[p.status], tone: p.status === 'Done' ? ('green' as Tone) : ('blue' as Tone) },
            meta: [bizName.get(p.business_id) ?? p.business_id, p.deadline ? `${md(p.deadline)} 마감` : null].filter(Boolean).join(' · '),
            right: `${Math.round(Number(p.progress_pct) || 0)}%`,
            example: p.is_example || undefined,
          })),
        }
      }
      case 'attendance':
        return {
          state: 'pending',
          text: '연동 준비 중 — 출근 기록 · 근무 상태 · 잔여 연차 · 부서 부재자는 아직 이 시스템에 없습니다.',
          links: access.approvals ? [{ href: '/e-approval?box=drafts&new=vacation', label: '휴가 신청(전자결재)' }] : [],
        }
      case 'favorites':
        return { state: 'ok', count: 0, items: [] }
    }
  } catch (e) {
    console.error('[home] 위젯 조회 실패', kind, e)
    return { state: 'error', text: '불러오지 못했습니다.' }
  }
  return { state: 'error', text: '알 수 없는 위젯입니다.' }
}

/** 즐겨찾기 후보 — 그 사람의 메뉴(사이드바와 같은 navFor) · 쓸 수 있는 결재 양식. 외부 시스템 링크는 승인 목록이 없어 넣지 않는다. */
export async function favoriteOptions(user: SessionUser, access: HomeAccess): Promise<FavoriteOption[]> {
  const hidden = (await loadSidebarData(user.role)).hiddenNav
  const menu = navFor(user.role, { purchasing: showsPurchasingNav(user), ledger: user.ledger, sales: showsSalesNav(user), production: showsProductionNav(user), costs: showsCostsNav(user), investment: user.investment, hidden })
    .flatMap((g) => g.items)
    .filter((i) => i.ready && i.key !== 'nav_home')
    .map((i) => ({ key: `nav:${i.key}`, label: i.label, href: i.href, group: '메뉴' as const }))
  const forms = access.approvals
    ? ((await (await eaStore()).forms().catch(() => [])) ?? [])
        .filter((f) => f.active)
        .map((f) => ({ key: `form:${f.form_key}`, label: f.name_ko, href: `/e-approval?box=drafts&new=${encodeURIComponent(f.form_key)}`, group: '결재 양식' as const }))
    : []
  return [...forms, ...menu]
}

/** 필수 공지 — 관리자(공지 쓰기 권한자 · 0038 Executive 이상)가 «맨 앞 고정»한 공지 중 내가 볼 수 있고 아직 안 내린 것. 개인이 숨기지 못한다. */
export async function requiredNotices(user: SessionUser): Promise<{ ok: true; items: { id: number; title: string; date: string }[] } | { ok: false }> {
  try {
    const today = kstToday()
    const rows = (await (await getRepository()).listNotices(user.user_id)).filter((n) => n.pinned && (!n.expires_on || n.expires_on >= today))
    return { ok: true, items: rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3).map((n) => ({ id: n.notice_id, title: n.title, date: md(n.created_at.slice(0, 10)) })) }
  } catch {
    return { ok: false }
  }
}
