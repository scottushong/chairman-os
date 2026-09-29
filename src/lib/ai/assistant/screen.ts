/**
 * 지금 화면이 무엇인가 — URL에서 «주제»를 읽는다(Phase 11 · 1 컨텍스트).
 *
 * 이니셔티브 상세에서 열면 그 이니셔티브가 기본 주제다. **값을 읽어 오지는 않는다** — 여기는 경로를
 * 뜻으로 바꿀 뿐이고, 무엇을 읽을지는 모델이 도구로 고른다(권한 안에서). 경로는 화면이 보낸 것이라
 * 믿지 않는다: 모양이 맞지 않으면 «알 수 없는 화면»으로 접는다.
 */

export type ScreenKind =
  | 'home'
  | 'initiative'
  | 'initiatives'
  | 'business'
  | 'finance'
  | 'finance_business'
  | 'approvals'
  | 'approval'
  | 'calendar'
  | 'attention'
  | 'dependency'
  | 'documents'
  | 'task'
  | 'morning'
  | 'chat'
  | 'other'

export interface ScreenSubject {
  kind: ScreenKind
  /** 화면이 가리키는 한 줄(이니셔티브 id · 회사 id · 결재 id · 업무 id). 없으면 null. */
  id: string | null
  /** 원래 경로(검증을 통과한 것만). */
  path: string
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

/** 앱 안 경로만 받는다. 0041의 근거 링크와 같은 모양(`/` 다음이 `/`나 `\`가 아니다). */
export function safePath(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 200) : ''
  return /^\/($|[^/\\])/.test(s) ? s : '/'
}

export function screenSubject(raw: unknown): ScreenSubject {
  const path = safePath(raw)
  const url = new URL(path, 'http://x')
  const parts = url.pathname.split('/').filter(Boolean)
  const id = (v: string | undefined) => (v && ID.test(v) ? v : null)

  const [a, b] = parts
  switch (a) {
    case undefined:
      return { kind: 'home', id: null, path }
    case 'initiatives':
      return b ? { kind: 'initiative', id: id(b), path } : { kind: 'initiatives', id: null, path }
    case 'business':
      return { kind: 'business', id: id(b), path }
    case 'finance':
      return b ? { kind: 'finance_business', id: id(b), path } : { kind: 'finance', id: null, path }
    case 'approvals': {
      const dec = id(url.searchParams.get('id') ?? undefined)
      return dec ? { kind: 'approval', id: dec, path } : { kind: 'approvals', id: null, path }
    }
    case 'calendar':
      return { kind: 'calendar', id: null, path }
    case 'attention':
      return { kind: 'attention', id: null, path }
    case 'dependency':
      return { kind: 'dependency', id: id(b), path }
    case 'documents':
      return { kind: 'documents', id: id(b), path }
    case 'tasks':
      return { kind: 'task', id: id(b), path }
    case 'ai':
      return { kind: 'morning', id: null, path }
    case 'chat':
      return { kind: 'chat', id: null, path }
    default:
      return { kind: 'other', id: null, path }
  }
}

export const SCREEN_LABEL_KO: Record<ScreenKind, string> = {
  home: '홈 대시보드',
  initiative: '이니셔티브 상세',
  initiatives: '이니셔티브 목록',
  business: '회사 상세',
  finance: '재무 전체',
  finance_business: '회사 재무',
  approvals: '결재 목록',
  approval: '결재 상세',
  calendar: '캘린더',
  attention: '주의(Attention)',
  dependency: '회장 의존도',
  documents: '문서',
  task: '업무 상세',
  morning: '아침 루틴(/ai)',
  chat: '메신저',
  other: '기타 화면',
}
