/**
 * 원가 엔진 엑셀 넣기(0068) — 화면 · 서버 액션 · 계획이 같이 보는 모양.
 *
 * 회장 결정(2026-10-11): 원가 엔진 자료는 엑셀로 **넣기만** 된다(빼기 없음). 겹치는 자료는 조용히 덮어쓰지 않는다 —
 * 미리보기에서 사람이 고르거나 고쳐야 등록된다. 등록은 DB 함수 한 번(cost_import_apply · 한 트랜잭션 · 전부 아니면 전무).
 *
 * 브라우저와 서버가 같이 본다 — exceljs · node 모듈을 끌어오지 않는다.
 */

export const IMPORT_TARGETS = ['materials', 'suppliers', 'market_prices', 'purchase_lots', 'overheads', 'production', 'bom'] as const
export type ImportTarget = (typeof IMPORT_TARGETS)[number]

export const IMPORT_TARGET_LABEL_KO: Record<ImportTarget, string> = {
  materials: '원료',
  suppliers: '공급처',
  market_prices: '시장가',
  purchase_lots: '구매 LOT',
  overheads: '비용 줄',
  production: '생산 LOT · 투입',
  bom: 'BOM',
}

/** 줄 상태 — 새 줄 · 같은 줄(자동 건너뜀) · 충돌 · 중복 의심 · 오류. */
export type RowStatus = 'new' | 'same' | 'conflict' | 'duplicate' | 'error'

export const ROW_STATUS_LABEL_KO: Record<RowStatus, string> = {
  new: '새 줄',
  same: '같은 줄(건너뜀)',
  conflict: '충돌',
  duplicate: '중복 의심',
  error: '오류',
}

/** 충돌 줄 처리 — 기존 유지(엑셀 줄 버림) · 엑셀 값으로 바꾸기(기존 줄 무효 + 새 줄, 이유 필수) · 둘 다 맞음(구분 칸이 다를 때만). */
export type ConflictChoice = 'keep' | 'replace' | 'both'

export interface ImportField {
  key: string
  label: string
  required: boolean
  /** 설명 시트 · 칸 맞추기 화면의 한 줄 설명. */
  hint: string
  /** 빈 양식의 예시 한 줄(가짜 값). */
  example: string
}

export interface PreviewRow {
  /** 엑셀 행 번호(1부터 — 엑셀 화면의 행 번호와 같다). 고치기 · 고르기의 열쇠. */
  row: number
  /** 칸 키 → 지금 값(고친 뒤). 화면에 그대로 그린다. */
  values: Record<string, string>
  /** 고친 칸 키(색 표시). */
  edited: string[]
  status: RowStatus
  /** 오류 · 충돌 · 중복 의심의 설명(사람 말). 새 줄 · 같은 줄은 ''. */
  message: string
  /** 충돌 · 중복 의심일 때 기존 줄 한 줄 요약(BOM은 값 없이 «판 있음»). */
  existing: string | null
  /** «둘 다 맞음»을 고를 수 있는가(구분 칸이 다를 때만). */
  canBoth: boolean
  /** «엑셀 값으로 바꾸기»를 고를 수 있는가(기존 줄과 겹칠 때만 — 파일 안 겹침은 «기존 유지»로 한 줄을 버린다). */
  canReplace: boolean
  /** 파일 안에서 겹친 다른 줄(엑셀 행 번호). */
  fileRow: number | null
  /** 이 줄이 다른 사람이 넣은 기존 줄을 바꾸는가(바꾸기를 고르면 그 사람에게 알림). */
  othersRow: boolean
}

export interface ImportDecisions {
  /** 시트 이름. 없으면 첫 자료 시트. */
  sheet?: string
  /** 머리글 행(1부터). 없으면 짐작. */
  headerRow?: number
  /** 칸 키 → 열 번호(0부터) 또는 null(그 칸 없음). 사람이 확정한 것. 없으면 머리글로 짐작. */
  mapping?: Record<string, number | null>
  /** 엑셀 행 → 칸 키 → 고친 값. */
  edits?: Record<string, Record<string, string>>
  /** 엑셀 행 → 충돌 처리. */
  choices?: Record<string, { choice: ConflictChoice; reason?: string }>
  /** «그래도 넣기»를 체크한 중복 의심 줄(엑셀 행). */
  dupOk?: number[]
  /** BOM — 진짜로 넣는가(«진짜 BOM 받기»가 켜져 있을 때만 의미). 기본 가짜. */
  realBom?: boolean
}

export interface ImportCounts {
  new: number
  same: number
  conflict: number
  duplicate: number
  error: number
}

export interface CostImportPreview {
  error?: string
  target?: ImportTarget
  fileName?: string
  sheets?: string[]
  sheet?: string
  headerRow?: number
  /** 머리글 행의 글자(열 번호 순서). */
  headers?: string[]
  fields?: ImportField[]
  /** 지금 쓴 칸 지정 · 사람이 확정했는가. */
  mapping?: Record<string, number | null>
  mappingConfirmed?: boolean
  rows?: PreviewRow[]
  counts?: ImportCounts
  /** 미리보기 순간의 자료 도장 — 등록 때 DB가 다시 재서 다르면 거부(«자료가 바뀌었습니다»). */
  stamp?: string
  /** 같은 파일(해시)을 이미 넣었으면 그 문장. 등록이 잠긴다. */
  seen?: string | null
  /** 등록 버튼이 잠긴 이유(없으면 null — 등록 가능). */
  locked?: string | null
  /** BOM — «진짜 BOM 받기»가 켜져 있는가. */
  realAllowed?: boolean
}

export interface CostImportCommit {
  error?: string
  /** 미리보기 뒤 자료가 바뀌었다 — 다시 미리보기. */
  stale?: boolean
  done?: { inserted: number; replaced: number; skipped: number }
}
