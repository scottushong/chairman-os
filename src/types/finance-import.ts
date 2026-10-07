/**
 * ECOUNT 엑셀 업로드 한 건 (0050 finance_imports).
 *
 * 값은 0050의 check 제약과 같은 목록이다. 한쪽만 늘면 화면이 만드는 업로드를 DB가 거부한다.
 * 설계: docs/superpowers/specs/2026-10-02-ecount-excel-import.md A절.
 */

/** 업로드 대상 셋 — 계정과목 · 연간 재무제표 · 월별 손익. 0050 finance_imports.kind. */
export const FINANCE_IMPORT_KIND = ['accounts', 'annual', 'monthly'] as const
export type FinanceImportKind = (typeof FINANCE_IMPORT_KIND)[number]

/** draft → committed | cancelled. 끝난 업로드는 다시 움직이지 않는다(0050 finance_imports_guard). */
export const FINANCE_IMPORT_STATUS = ['draft', 'committed', 'cancelled'] as const
export type FinanceImportStatus = (typeof FINANCE_IMPORT_STATUS)[number]

export const FINANCE_IMPORT_KIND_LABEL_KO: Record<FinanceImportKind, string> = {
  accounts: '계정과목',
  annual: '연간 재무제표',
  monthly: '월별 손익',
}

export const FINANCE_IMPORT_STATUS_LABEL_KO: Record<FinanceImportStatus, string> = {
  draft: '진행 중',
  committed: '등록됨',
  cancelled: '취소됨',
}

export interface FinanceImport {
  import_id: string
  business_id: string
  kind: FinanceImportKind
  /** annual 'YYYY' · monthly 'YYYY' 또는 'YYYY-MM' · accounts는 null. 대상별 미리보기가 채운다. */
  period_key: string | null
  status: FinanceImportStatus
  file_name: string
  /** 미리보기가 원본을 처음 읽을 때 적는다. 한 번 적히면 못 바꾼다 — 등록이 «그 파일»인지 이 값으로 잰다. */
  file_sha256: string | null
  /** 행 수 · 시트 · 기간 같은 개요. 금액 원문은 두지 않는다(원본은 첨부다). */
  summary: Record<string, unknown> | null
  created_by: string
  created_at: string
  updated_at: string
  committed_at: string | null
  cancelled_at: string | null
}

/** 미리보기가 적는 칸. 상태는 바꾸지 않는다. */
export interface FinanceImportPreviewPatch {
  file_sha256: string
  summary: Record<string, unknown>
  period_key?: string | null
}
