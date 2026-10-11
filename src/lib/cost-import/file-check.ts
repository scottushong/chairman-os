import { makeFileCheck, type FileCheck } from '@/lib/file-drop'

/**
 * 원가 엔진 엑셀 넣기 — 받는 파일(브라우저 · 서버가 같이 본다). .xlsx 한 개, 2MB까지.
 * 바이트 앞머리(옛 .xls · 웹 표 · CSV)는 올리기 직전에 ecountBytesProblem이 보고, 서버가 다시 읽어 한 번 더 본다.
 */

export const COST_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const COST_IMPORT_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const SAVE_AS_XLSX = '엑셀에서 «다른 이름으로 저장 → Excel 통합 문서(*.xlsx)»로 저장한 뒤 넣으세요.'

function nameProblem(fileName: string): string | null {
  const ext = fileName.toLowerCase().trim().split('.').pop() ?? ''
  if (!fileName.includes('.')) return '확장자가 없는 파일입니다. 엑셀(.xlsx) 파일만 받습니다.'
  if (ext === 'xlsx') return null
  if (ext === 'xls') return `.xls(옛 엑셀 형식)는 받지 않습니다. ${SAVE_AS_XLSX}`
  if (ext === 'csv') return `CSV는 받지 않습니다. ${SAVE_AS_XLSX}`
  return '엑셀(.xlsx) 파일만 받습니다.'
}

const sizeCheck = makeFileCheck({ typeOk: () => true, formats: '엑셀(.xlsx)', maxBytes: COST_IMPORT_MAX_BYTES })

export const checkCostImportFile: FileCheck = (file) => nameProblem(file.name) ?? sizeCheck(file)
