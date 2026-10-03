import { FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImportKind } from '@/types'

/**
 * ECOUNT 엑셀 업로드 — 받는 파일 · 감사 문구. **브라우저와 서버가 같이 본다**(exceljs를 끌어오지 않는다).
 * 설계서 A «.xls · csv는 받지 않고 «xlsx로 저장» 안내».
 *
 * 파일 이름(확장자)과 바이트(앞머리)를 따로 본다 — 이름은 바꿀 수 있고, ECOUNT의 «엑셀 내려받기»가
 * 실제로는 웹 표(HTML)나 옛 형식(.xls)을 주는 일이 있다. 둘 다 통과해야 파서로 간다.
 */

export const ECOUNT_XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const SAVE_AS_XLSX = '엑셀에서 열어 «다른 이름으로 저장 → Excel 통합 문서(*.xlsx)»로 저장한 뒤 올리세요.'

/** 파일 이름으로 먼저 거른다. 통과면 null. */
export function ecountFileProblem(fileName: string): string | null {
  const ext = fileName.toLowerCase().trim().split('.').pop() ?? ''
  if (!fileName.includes('.')) return `확장자가 없는 파일입니다. ECOUNT에서 내려받은 엑셀(.xlsx) 파일만 받습니다.`
  if (ext === 'xlsx') return null
  if (ext === 'xls') return `.xls(옛 엑셀 형식)는 받지 않습니다. ${SAVE_AS_XLSX}`
  if (ext === 'csv') return `CSV는 받지 않습니다. ECOUNT에서 엑셀로 내려받거나, ${SAVE_AS_XLSX}`
  return 'ECOUNT에서 내려받은 엑셀(.xlsx) 파일만 받습니다.'
}

/**
 * 바이트 앞머리로 형식을 본다. xlsx는 zip(PK\x03\x04)이다. 통과면 null.
 *   D0 CF 11 E0 …  옛 엑셀(.xls, OLE) — 이름만 .xlsx로 바꾼 경우
 *   «<» 로 시작     웹 표(HTML) — ECOUNT · 그룹웨어의 «엑셀 내려받기»가 흔히 이렇게 준다
 *   그 밖           CSV · 텍스트 · 다른 파일
 */
export function ecountBytesProblem(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return null
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  if (bytes.length >= 8 && ole.every((b, i) => bytes[i] === b)) {
    return `파일 내용이 옛 엑셀 형식(.xls)입니다. ${SAVE_AS_XLSX}`
  }
  // UTF-8 BOM · 공백을 건너뛰고 첫 글자를 본다.
  let i = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  while (i < bytes.length && i < 512 && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1
  if (bytes[i] === 0x3c) return `파일 내용이 엑셀이 아니라 웹 표(HTML)입니다. ${SAVE_AS_XLSX}`
  return `엑셀(xlsx) 파일이 아닙니다(CSV · 텍스트일 수 있습니다). ${SAVE_AS_XLSX}`
}

/** 감사 기록의 파일 이름 — 줄바꿈 · 제어 문자를 걷고 120자로 자른다(한 줄 note). */
function noteFileName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > 120 ? `${clean.slice(0, 119)}…` : clean
}

/**
 * 대상별 등록 RPC가 audit_log.note에 적는 문구(설계서 A «감사»):
 * «ECOUNT 엑셀 업로드 — {종류} {기간} · 파일 {이름} · import {id}». 계정과목은 기간이 없다.
 */
export function ecountAuditNote(input: { kind: FinanceImportKind; period: string | null; fileName: string; importId: string }): string {
  const what = [FINANCE_IMPORT_KIND_LABEL_KO[input.kind], input.period?.trim()].filter(Boolean).join(' ')
  return `ECOUNT 엑셀 업로드 — ${what} · 파일 ${noteFileName(input.fileName)} · import ${input.importId}`
}
