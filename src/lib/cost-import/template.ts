import ExcelJS from 'exceljs'

import { IMPORT_FIELDS } from './spec'
import { IMPORT_TARGET_LABEL_KO, type ImportTarget } from './types'

/**
 * 빈 양식 — 칸 이름 · 예시 한 줄 · 설명 시트만. **실제 자료 0**: 저장소(repository)를 부르지 않는다 — 이 파일의 모든 글자는
 * spec.ts의 고정 문구다(check:cost-import가 import 목록과 결과 셀을 본다). 회장 결정 2026-10-11 «빈 양식은 허용».
 */
export function buildImportTemplate(target: ImportTarget): ExcelJS.Workbook {
  const fields = IMPORT_FIELDS[target]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(IMPORT_TARGET_LABEL_KO[target].replace(/[·\s]+/g, ''))
  ws.addRow(fields.map((f) => f.label))
  ws.addRow(fields.map((f) => f.example))
  ws.getRow(1).font = { bold: true }
  ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } }
  fields.forEach((f, i) => (ws.getColumn(i + 1).width = Math.max(10, f.label.length * 2 + 4)))

  const help = wb.addWorksheet('설명')
  help.addRow(['칸', '꼭', '설명'])
  help.getRow(1).font = { bold: true }
  for (const f of fields) help.addRow([f.label, f.required ? '예' : '', f.hint])
  help.addRow([])
  help.addRow(['', '', '2행은 예시(가짜 값)입니다 — 지우고 실제 줄을 적으세요. 그대로 두면 예시도 한 줄로 읽힙니다.'])
  help.addRow(['', '', '이름(원료 · 공급처 · 제품)을 못 찾으면 그 줄은 오류입니다 — 먼저 원료 · 공급처 엑셀을 넣으세요.'])
  help.addRow(['', '', '이미 있는 자료와 겹치면 미리보기에서 «기존 유지 / 엑셀 값으로 바꾸기 / 둘 다 맞음»을 골라야 등록됩니다.'])
  help.getColumn(1).width = 18
  help.getColumn(3).width = 90
  return wb
}

export function templateFileName(target: ImportTarget): string {
  return `양식-${IMPORT_TARGET_LABEL_KO[target].replace(/[·\s]+/g, '')}.xlsx`
}
