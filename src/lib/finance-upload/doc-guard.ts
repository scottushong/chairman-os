import { normalizeLabel } from '@/lib/ecount/excel/detect'
import { detectMixRatio } from '@/lib/intake/mix-ratio'

import { MSG } from './open'

/**
 * C단계 — PDF · 사진을 **AI에 보내기 전에** 코드가 막는 것(파일 이름 + 뽑은 글). AI 경로(src/lib/ai) 밖에 둔다
 * (check:cost-import가 그 경로에서 구성표 낱말을 금지한다 — 막는 목록은 여기 있어야 한다).
 *
 *   formula    배합비 · 구성표(BOM) · 레시피로 보이는 파일 — 저장도(기록 줄 하나도) AI도 없다. 엑셀 · PDF · 사진 모두.
 *   payroll    급여대장 PDF · 사진 — 이름 · 주민번호를 지울 수 없어 AI에 안 보냄(기록은 «실패»로 파일 이름 · 해시만).
 *   production 제조지시명세서 PDF · 사진 — 원료 투입 줄을 지울 수 없어 AI에 안 보냄.
 *   issue      원료 출고명세 PDF · 사진 — 0072가 출고명세를 AI에 보내지 않기로 했다(kg 노출 금지).
 *
 * 글이 없는 스캔 · 사진은 **파일 이름만** 볼 수 있다(값싼 첫 쪽 판정은 AI 없이 안 된다). 그래서 이름에 낱말이 조금만 비쳐도 막고,
 * 이름이 평범한 스캔은 AI가 읽은 뒤 종류가 급여 · 제조지시 · 출고명세로 나오면 그 결과를 버리고 같은 문구로 막는다
 * (이 경우 AI는 이미 그림을 봤다 — 남은 위험, 보고서 · DEFERRED에 적음).
 */

export type DocRefusalCode = 'formula' | 'payroll' | 'production' | 'issue'

export interface DocRefusal {
  code: DocRefusalCode
  message: string
  /** false면 fin_uploads에 실패 기록 줄도 남기지 않는다(배합비 · 구성표). */
  record: boolean
}

export const FORMULA_MSG = '이 파일은 받을 수 없습니다 — 배합비 · 구성표(BOM) · 레시피로 보이는 파일은 저장하지도 AI에 보내지도 않습니다.'
export const ISSUE_DOC_MSG = '원료 출고명세는 엑셀로 올려 주세요 — PDF · 사진은 원료별 kg를 지울 수 없어 AI에 보내지 않습니다.'

const FORMULA_NAME = /배합비|배합표|배합\s*비율|배합\s*명세|레시피|recipe|(^|[^a-z])bom([^a-z]|$)|bill\s*of\s*materials?|소요량\s*표|원료\s*구성표|제품\s*구성표|처방전/i
const FORMULA_TEXT = /배합비|배합표|배합\s*비율|레시피|bill\s*of\s*materials?|(^|[^a-z])bom([^a-z]|$)|소요량\s*표|제품\s*구성표|원료\s*구성표/i

const PAYROLL_NAME = /급여|임금|상여|월급|payroll|salary|pay\s*slip/i
const PAYROLL_TEXT = /급여\s*대장|임금\s*대장|급여\s*명세|급여\s*지급\s*명세|임금\s*명세|주민\s*(등록)?\s*번호/
const RRN = /(^|\D)\d{6}\s*-\s*[1-8]\d{6}(\D|$)/

const PRODUCTION_NAME = /제조\s*지시|작업\s*지시|생산\s*지시|생산\s*실적|work\s*order/i
const PRODUCTION_TEXT = /제조\s*지시\s*명세|제조\s*지시서|작업\s*지시서|생산\s*지시서/

const ISSUE_NAME = /(원료|자재|원재료|부재료)\s*(출고|불출)|불출/
const ISSUE_TEXT_A = /출고|불출/
const ISSUE_TEXT_B = /원료|원재료|부재료|자재/

const OFFICIAL_NAME = /표준\s*재무\s*제표|재무\s*제표|재무\s*상태표|대차\s*대조표|손익\s*계산서|결산\s*(서|보고)|세무\s*조정/
const OFFICIAL_TEXT = /표준\s*재무\s*제표|표준\s*대차\s*대조표|표준\s*손익\s*계산서/

const name = (fileName: string) => fileName.normalize('NFKC').replace(/\.[a-z0-9]+$/i, '')

/** 모든 형식(엑셀 포함) — 이름 · (있으면) 앞쪽 글로 배합비 · 구성표 파일을 알아본다. 맞으면 저장도 AI도 없다. */
export function refuseFormula(fileName: string, text = ''): DocRefusal | null {
  if (FORMULA_NAME.test(name(fileName)) || FORMULA_TEXT.test(text.slice(0, 4000))) return { code: 'formula', message: FORMULA_MSG, record: false }
  return null
}

/**
 * PDF · 사진 — AI 전에. text는 PDF 글 층(스캔 · 사진은 '').
 * 글이 있으면 앞 4,000자의 제목 낱말 · 주민번호 모양으로, 없으면 파일 이름으로만.
 */
export function refuseDoc(fileName: string, text: string): DocRefusal | null {
  const formula = refuseFormula(fileName, text)
  if (formula) return formula
  const n = name(fileName)
  const head = text.slice(0, 4000)
  const t = normalizeLabel(head)
  if (PAYROLL_NAME.test(n) || PAYROLL_TEXT.test(head) || PAYROLL_TEXT.test(t) || RRN.test(head)) return { code: 'payroll', message: MSG.payrollDoc, record: true }
  if (PRODUCTION_NAME.test(n) || PRODUCTION_TEXT.test(head) || PRODUCTION_TEXT.test(t)) return { code: 'production', message: MSG.productionDoc, record: true }
  if (ISSUE_NAME.test(n) || (ISSUE_TEXT_A.test(t.slice(0, 600)) && ISSUE_TEXT_B.test(t.slice(0, 600)))) return { code: 'issue', message: ISSUE_DOC_MSG, record: true }
  // 글 PDF는 표 모양도 본다(입구 0058의 배합비 감지 — 퍼센트 열 합 100 · 낱말 + 원료명 · 비율 열). 결산서는 구성비(%) 열이 흔해 빼고 본다.
  if (text && !looksOfficial(fileName, text) && detectMixRatio([text]).hit) return { code: 'formula', message: FORMULA_MSG, record: false }
  return null
}

/** AI가 읽은 뒤 — 종류가 급여 · 제조지시 · 출고명세로 나오면 결과를 버린다(저장 전). */
export function refuseAfterRead(kind: string): DocRefusal | null {
  if (kind === 'payroll') return { code: 'payroll', message: MSG.payrollDoc, record: true }
  if (kind === 'production') return { code: 'production', message: MSG.productionDoc, record: true }
  if (kind === 'material_issue') return { code: 'issue', message: ISSUE_DOC_MSG, record: true }
  return null
}

/** 세무사 확정 결산(표준재무제표 · 재무상태표 · 손익계산서)으로 보이는가 — 이름 또는 글. 맞으면 fin_* 대신 «공식 결산» 길로. */
export function looksOfficial(fileName: string, text: string): boolean {
  const head = text.slice(0, 4000)
  return OFFICIAL_NAME.test(name(fileName)) || OFFICIAL_TEXT.test(head) || (/재무\s*상태표|대차\s*대조표/.test(head) && /손익\s*계산서/.test(head))
}
