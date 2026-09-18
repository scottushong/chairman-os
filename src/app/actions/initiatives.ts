'use server'

import { revalidatePath } from 'next/cache'

import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import {
  EVENT_KIND, INITIATIVE_KIND, INITIATIVE_STAGE, INITIATIVE_STATUS,
  type ChairmanEvent, type EventKind, type Initiative, type InitiativeDoc, type InitiativeKind,
  type InitiativeStage, type InitiativeStatus, type IsoDate,
} from '@/types'

/**
 * 이니셔티브 Server Action (Phase 4-A).
 *
 * 한 번에 한 칸만 받는다. 전문을 통째로 받으면 audit_log의 before/after가 늘 전문이 되어
 * '무엇이 바뀌었나'를 사람이 눈으로 찾아야 한다 — strategy.ts와 같은 이유다.
 *
 * 권한을 여기서 보지 않는다. 연필이 안 보이는 사람이 이 함수를 직접 불러도 0017 RLS가 거부한다.
 */

export interface ActionState { error?: string }

const MAX_TEXT = 500
/** 회장 개인 메모는 판단을 적는 자리라 한 칸보다 길다 — 그래도 문서 전체를 실수로 붙여 넣는 사고는 잡는다. */
const NOTE_MAX = 5_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 트랩 2: `DATE.test('9999-99-99')`는 통과한다 — 자릿수만 보기 때문이다.
 * chairman.ts의 isDate/keymen.ts의 last_contact_on 검사와 같은 이유로, 형식뿐 아니라
 * 실재하는 날짜인지까지 본다. 달력에 없는 날짜가 target_date/next_action_date/이벤트 날짜로
 * 들어가면 캘린더 뷰(calendar_items)와 야간 브리핑이 그 값을 그대로 정렬·비교하게 된다.
 */
function isDate(value: string): boolean {
  return DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** 자유 서술 칸. 나머지는 열거값이거나 날짜라 따로 검사한다. */
const TEXT_FIELDS = ['title', 'goal', 'next_action', 'next_action_owner', 'blocker'] as const
const DATE_FIELDS = ['target_date', 'next_action_date'] as const

export type InitiativeField =
  | (typeof TEXT_FIELDS)[number]
  | (typeof DATE_FIELDS)[number]
  | 'kind' | 'stage' | 'status' | 'business_id'

/**
 * 0017_initiatives.sql의 쓰기 정책 이름 전부(initiative_keymen_write 제외 — 그건 keymen.ts의
 * initiativeFailure()가 따로 본다): initiatives_write, initiative_docs_write, events_write,
 * initiative_notes_all. 이 함수는 그 넷을 쓰는 saveInitiativeField/createInitiative(initiatives),
 * saveInitiativeNoteAction(initiative_notes), saveInitiativeDocAction/removeInitiativeDocAction
 * (initiative_docs), saveEventAction/removeEventAction(events)가 전부 같이 쓴다 —
 * 넷 중 하나라도 빠지면 그 표에서 난 권한 거부가 '잠시 후 다시 시도'로 잘못 안내된다.
 */
function failure(e: unknown): ActionState {
  console.error('[initiatives]', e)
  return {
    error:
      e instanceof Error &&
      /initiatives_write|initiative_docs_write|events_write|initiative_notes_all|42501|PGRST301/.test(e.message)
        ? '이 건을 고칠 권한이 없습니다. (회장 / 그룹 CFO만 가능합니다)'
        : '저장하지 못했습니다. 잠시 후 다시 시도하세요.',
  }
}

export async function saveInitiativeField(
  initiativeId: unknown,
  field: unknown,
  value: unknown,
): Promise<ActionState> {
  const id = typeof initiativeId === 'string' ? initiativeId.trim() : ''
  if (!id) return { error: '어느 건인지 알 수 없습니다.' }

  const raw = typeof value === 'string' ? value.trim() : ''
  let patch: Partial<Initiative>

  if (TEXT_FIELDS.includes(field as (typeof TEXT_FIELDS)[number])) {
    if (raw.length > MAX_TEXT) {
      return { error: `${MAX_TEXT}자를 넘길 수 없습니다. (현재 ${raw.length}자)` }
    }
    if (field === 'title' && !raw) return { error: '제목은 비울 수 없습니다.' }
    patch = { [field as string]: raw }
  } else if (DATE_FIELDS.includes(field as (typeof DATE_FIELDS)[number])) {
    // 빈 값은 '기한 없음'이다. 지우는 것도 저장이다.
    if (raw && !isDate(raw)) return { error: '날짜는 YYYY-MM-DD 형식입니다.' }
    patch = { [field as string]: raw || null }
  } else if (field === 'kind') {
    if (!INITIATIVE_KIND.includes(raw as InitiativeKind)) return { error: '알 수 없는 유형입니다.' }
    patch = { kind: raw as InitiativeKind }
  } else if (field === 'stage') {
    if (!INITIATIVE_STAGE.includes(raw as InitiativeStage)) return { error: '알 수 없는 단계입니다.' }
    patch = { stage: raw as InitiativeStage }
  } else if (field === 'status') {
    if (!INITIATIVE_STATUS.includes(raw as InitiativeStatus)) return { error: '알 수 없는 상태입니다.' }
    patch = { status: raw as InitiativeStatus }
  } else if (field === 'business_id') {
    patch = { business_id: raw || null }
  } else {
    return { error: '알 수 없는 항목입니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const before = await repo.getInitiative(id)
    if (!before) return { error: '이 건을 찾을 수 없습니다.' }
    // initiative_id/updated_at은 InitiativeInput에 없다 — 스프레드에서 반드시 떨어져야 한다.
    const { initiative_id: _drop, updated_at: _drop2, ...rest } = before
    void _drop
    void _drop2
    await repo.saveInitiative(
      { initiative_id: id, ...rest, ...patch },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    return failure(e)
  }

  revalidatePath('/initiatives')
  revalidatePath(`/initiatives/${id}`)
  revalidatePath('/calendar')
  revalidatePath('/')
  return {}
}

/**
 * 새 건은 제목과 유형만 받는다. 나머지는 기본값으로 만든 뒤 상세로 보내 칸별로 채운다 —
 * 빈 칸을 먼저 다 채우게 하면 회장이 목록에 건을 못 올린다.
 */
export async function createInitiative(
  title: unknown,
  kind: unknown,
): Promise<ActionState & { initiativeId?: string }> {
  const t = typeof title === 'string' ? title.trim() : ''
  if (!t) return { error: '제목을 넣으세요.' }
  if (t.length > MAX_TEXT) return { error: `${MAX_TEXT}자를 넘길 수 없습니다.` }
  if (!INITIATIVE_KIND.includes(kind as InitiativeKind)) return { error: '유형을 고르세요.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const saved = await repo.saveInitiative(
      {
        title: t, kind: kind as InitiativeKind, business_id: null, stage: 'Planning',
        goal: '', target_date: null, next_action: '', next_action_date: null,
        next_action_owner: '', blocker: '', status: 'Active',
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/initiatives')
    revalidatePath('/')
    return { initiativeId: saved.initiative_id }
  } catch (e) {
    return failure(e)
  }
}

/** 회장 개인 메모. Chairman이 아니면 0017 initiative_notes_all이 거부한다. */
export async function saveInitiativeNoteAction(initiativeId: unknown, note: unknown): Promise<ActionState> {
  const id = typeof initiativeId === 'string' ? initiativeId.trim() : ''
  if (!id) return { error: '어느 건인지 알 수 없습니다.' }

  // 앞뒤 공백만 걷는다. 안쪽 줄바꿈·빈 줄은 문단이라 그대로 둔다. CRLF는 LF로 맞춘다.
  const value = typeof note === 'string' ? note.replace(/\r\n?/g, '\n').trim() : ''
  if (value.length > NOTE_MAX) {
    return { error: `${NOTE_MAX.toLocaleString()}자를 넘길 수 없습니다. (현재 ${value.length.toLocaleString()}자)` }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.saveInitiativeNote(id, value, { user_id: user.user_id, role: user.role })
  } catch (e) {
    return failure(e)
  }

  revalidatePath(`/initiatives/${id}`)
  return {}
}

export interface InitiativeDocState extends ActionState { saved?: InitiativeDoc }

export async function saveInitiativeDocAction(input: unknown): Promise<InitiativeDocState> {
  const f = (input ?? {}) as Record<string, unknown>
  const initiative_id = typeof f.initiative_id === 'string' ? f.initiative_id.trim() : ''
  const title = typeof f.title === 'string' ? f.title.trim() : ''
  const url = typeof f.url === 'string' ? f.url.trim() : ''
  const doc_id = typeof f.doc_id === 'string' ? f.doc_id.trim() : ''

  if (!initiative_id) return { error: '어느 건인지 알 수 없습니다.' }
  if (!title) return { error: '문서명을 입력하세요.' }
  if (title.length > MAX_TEXT) return { error: `${MAX_TEXT}자를 넘길 수 없습니다.` }
  // 0017 initiative_docs의 url 체크(`url ~ '^https?://'`)와 같은 기준이다.
  if (!isHttpUrl(url)) return { error: '링크는 http:// 또는 https:// 로 시작해야 합니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const saved = await repo.saveInitiativeDoc(
      { doc_id: doc_id || undefined, initiative_id, title, url },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath(`/initiatives/${initiative_id}`)
    return { saved }
  } catch (e) {
    return failure(e)
  }
}

/**
 * initiativeId를 같이 받는다 — removeKeyman(keymanId, businessId)와 같은 이유다.
 * 문서 패널은 이니셔티브 상세 화면 하나뿐이라 지운 뒤 그 화면을 다시 그려야 하는데,
 * docId만으로는 어느 상세 화면인지 알 수 없다.
 */
export async function removeInitiativeDocAction(docId: unknown, initiativeId: unknown): Promise<ActionState> {
  const id = typeof docId === 'string' ? docId.trim() : ''
  if (!id) return { error: '지울 문서를 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.removeInitiativeDoc(id, { user_id: user.user_id, role: user.role })
  } catch (e) {
    return failure(e)
  }

  const iid = typeof initiativeId === 'string' ? initiativeId.trim() : ''
  if (iid) revalidatePath(`/initiatives/${iid}`)
  return {}
}

export interface EventState extends ActionState { saved?: ChairmanEvent }

export async function saveEventAction(input: unknown): Promise<EventState> {
  const f = (input ?? {}) as Record<string, unknown>
  const title = typeof f.title === 'string' ? f.title.trim() : ''
  const startsOn = typeof f.starts_on === 'string' ? f.starts_on.trim() : ''
  const endsOn = typeof f.ends_on === 'string' ? f.ends_on.trim() : ''

  if (!title) return { error: '제목을 넣으세요.' }
  if (title.length > MAX_TEXT) return { error: `${MAX_TEXT}자를 넘길 수 없습니다.` }
  if (!isDate(startsOn)) return { error: '시작일은 YYYY-MM-DD 형식입니다.' }
  if (endsOn && !isDate(endsOn)) return { error: '종료일은 YYYY-MM-DD 형식입니다.' }
  if (endsOn && endsOn < startsOn) return { error: '종료일이 시작일보다 앞설 수 없습니다.' }
  if (!EVENT_KIND.includes(f.kind as EventKind)) return { error: '일정 종류를 고르세요.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    const saved = await repo.saveEvent(
      {
        event_id: typeof f.event_id === 'string' && f.event_id ? f.event_id : undefined,
        title,
        starts_on: startsOn as IsoDate,
        ends_on: (endsOn || null) as IsoDate | null,
        kind: f.kind as EventKind,
        initiative_id: typeof f.initiative_id === 'string' && f.initiative_id ? f.initiative_id : null,
        business_id: typeof f.business_id === 'string' && f.business_id ? f.business_id : null,
        location: typeof f.location === 'string' ? f.location.trim() : '',
        note: typeof f.note === 'string' ? f.note.trim() : '',
      },
      { user_id: user.user_id, role: user.role },
    )
    revalidatePath('/calendar')
    revalidatePath('/initiatives')
    if (saved.initiative_id) revalidatePath(`/initiatives/${saved.initiative_id}`)
    return { saved }
  } catch (e) {
    return failure(e)
  }
}

/**
 * initiativeId는 선택이다 — 이벤트는 이니셔티브에도 회사에도 안 걸릴 수 있다.
 * 걸려 있을 때는 saveEventAction과 대칭으로 그 상세 화면도 다시 그린다 — 지운 이벤트가
 * 캘린더에서는 사라졌는데 이니셔티브 상세에는 그대로 남는 사고를 막는다.
 * 화면(삭제 버튼)은 이 값을 렌더링 시점에 이미 알고 있으므로 호출부가 늘 넘길 수 있다.
 */
export async function removeEventAction(eventId: unknown, initiativeId?: unknown): Promise<ActionState> {
  const id = typeof eventId === 'string' ? eventId.trim() : ''
  if (!id) return { error: '지울 일정을 알 수 없습니다.' }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }

  try {
    const repo = await getRepository()
    await repo.removeEvent(id, { user_id: user.user_id, role: user.role })
  } catch (e) {
    return failure(e)
  }

  revalidatePath('/calendar')
  revalidatePath('/initiatives')
  const iid = typeof initiativeId === 'string' ? initiativeId.trim() : ''
  if (iid) revalidatePath(`/initiatives/${iid}`)
  return {}
}
