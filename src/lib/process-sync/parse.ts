/**
 * 프로세스 차트 시트 → 동기화 줄 (0071). 순수 함수 — 네트워크 · DB 없음. npm run check:process-sync가 잰다.
 *
 * 제목 줄: ID | 단계 | 업무명 | 담당자 이메일 | 시작일 | 마감일 | 상태 | 비고
 *   이름으로 찾는다(순서가 달라도, 앞뒤 공백 · 대소문자가 달라도 된다). ID · 업무명이 없으면 시트 전체를 거부한다 —
 *   그 둘 없이 넣으면 «같은 업무» 판단이 서지 않는다. 나머지 칸은 없으면 빈 값으로 본다.
 *   제목 줄은 맨 위 5줄 안에서 «ID»가 있는 첫 줄이다(시트 머리에 제목 · 설명 줄을 두는 일이 흔하다).
 *
 * 줄 검사(대표 결정 2026-10-12):
 *   ID 없음            건너뜀 + 경고
 *   날짜 형식 틀림      건너뜀 + 경고  (2026-10-12 · 2026.10.12 · 2026/10/12 · «2026. 10. 12» 받음)
 *   상태               예정 · 진행 · 완료 · 보류만. 다른 값은 «예정» + 경고. 비어 있으면 «예정»(경고 없음)
 *   같은 ID 두 번      두 번째부터 건너뜀 + 경고(같은 업무가 두 번 들어가면 안 된다)
 *   업무명 없음        건너뜀 + 경고(업무 관리에 이름 없는 업무를 만들지 않는다)
 *   통째로 빈 줄        세지 않는다(읽은 줄에도 안 들어간다)
 */
import { PROCESS_ITEM_STATUS, type ProcessItemStatus, type ProcessSyncWarning } from '@/types'

export const PROCESS_SHEET_HEADERS = ['ID', '단계', '업무명', '담당자 이메일', '시작일', '마감일', '상태', '비고'] as const
type HeaderName = (typeof PROCESS_SHEET_HEADERS)[number]

/** 한 번에 넣는 줄의 상한 — DB 함수(0071 process_chart_sync_apply)와 같다. */
export const PROCESS_SYNC_MAX_ROWS = 2000

export interface ProcessSyncRow {
  id: string
  stage: string
  title: string
  email: string
  start: string | null
  due: string | null
  status: ProcessItemStatus
  note: string
}

export interface ParsedSheet {
  /** 제목 줄 문제. 있으면 rows는 비고 동기화는 실패로 기록된다. */
  headerProblem: string | null
  rows: ProcessSyncRow[]
  /** 읽은 줄(빈 줄 제외, 건너뛴 줄 포함) */
  read: number
  skipped: number
  warnings: ProcessSyncWarning[]
}

const norm = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const headerKey = (v: string) => v.replace(/\s+/g, '').toLowerCase()

/** 'YYYY-MM-DD' 또는 null(빈 칸). 형식이 틀리면 undefined. 진짜 있는 날짜인지(2월 30일 거부)까지 본다. */
export function parseSheetDate(raw: string): string | null | undefined {
  const v = raw.trim()
  if (v === '') return null
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(v)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function parseProcessSheet(values: readonly (readonly unknown[])[]): ParsedSheet {
  const out: ParsedSheet = { headerProblem: null, rows: [], read: 0, skipped: 0, warnings: [] }

  const headerAt = values.slice(0, 5).findIndex((r) => r.some((c) => headerKey(norm(c)) === 'id'))
  if (headerAt < 0) {
    out.headerProblem = '제목 줄을 찾지 못했습니다. 맨 위에 «ID | 단계 | 업무명 | 담당자 이메일 | 시작일 | 마감일 | 상태 | 비고» 줄이 있어야 합니다.'
    return out
  }
  const header = values[headerAt].map((c) => headerKey(norm(c)))
  const col = {} as Record<HeaderName, number>
  for (const name of PROCESS_SHEET_HEADERS) col[name] = header.indexOf(headerKey(name))
  if (col['업무명'] < 0) {
    out.headerProblem = '제목 줄에 «업무명» 칸이 없습니다.'
    return out
  }
  const cell = (r: readonly unknown[], name: HeaderName) => (col[name] < 0 ? '' : norm(r[col[name]]))

  const seen = new Set<string>()
  for (let i = headerAt + 1; i < values.length; i++) {
    const r = values[i]
    const rowNo = i + 1 // 시트의 줄 번호(1부터)
    if (!r || r.every((c) => norm(c) === '')) continue
    out.read++
    if (out.read > PROCESS_SYNC_MAX_ROWS) {
      out.skipped++
      if (out.read === PROCESS_SYNC_MAX_ROWS + 1) {
        out.warnings.push({ row: rowNo, id: null, message: `한 번에 ${PROCESS_SYNC_MAX_ROWS}줄까지 넣습니다. 나머지는 건너뛰었습니다.` })
      }
      continue
    }
    const skip = (message: string, id: string | null = null) => {
      out.skipped++
      out.warnings.push({ row: rowNo, id, message })
    }

    const id = cell(r, 'ID')
    if (id === '') { skip('ID가 없어 건너뛰었습니다.'); continue }
    if (id.length > 100) { skip('ID가 너무 깁니다(100자까지). 건너뛰었습니다.', id.slice(0, 100)); continue }
    if (seen.has(id)) { skip(`ID «${id}»가 시트에 두 번 있습니다. 두 번째 줄은 건너뛰었습니다.`, id); continue }

    const title = cell(r, '업무명')
    if (title === '') { skip('업무명이 없어 건너뛰었습니다.', id); continue }

    const start = parseSheetDate(cell(r, '시작일'))
    if (start === undefined) { skip(`시작일 «${cell(r, '시작일')}»의 날짜 형식이 틀려 건너뛰었습니다(예: 2026-10-12).`, id); continue }
    const due = parseSheetDate(cell(r, '마감일'))
    if (due === undefined) { skip(`마감일 «${cell(r, '마감일')}»의 날짜 형식이 틀려 건너뛰었습니다(예: 2026-10-12).`, id); continue }

    const rawStatus = cell(r, '상태')
    let status: ProcessItemStatus = '예정'
    if (rawStatus !== '') {
      if ((PROCESS_ITEM_STATUS as readonly string[]).includes(rawStatus)) status = rawStatus as ProcessItemStatus
      else out.warnings.push({ row: rowNo, id, message: `상태 «${rawStatus}»는 예정 · 진행 · 완료 · 보류가 아니어서 «예정»으로 넣었습니다.` })
    }

    seen.add(id)
    out.rows.push({
      id,
      stage: cell(r, '단계').slice(0, 200),
      title: title.slice(0, 500),
      email: cell(r, '담당자 이메일').slice(0, 320),
      start,
      due,
      status,
      note: cell(r, '비고').slice(0, 2000),
    })
  }
  return out
}
