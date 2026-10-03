import { UNIT_LABEL_KO } from '@/lib/ecount/excel/cells'
import type { SheetOutline } from '@/lib/ecount/excel/workbook'

/**
 * 서버가 원본을 다시 읽은 개요 — 시트 · 행 수 · 기간 · 단위 · 읽지 못한 칸. 금액은 없다(대상별 미리보기에서).
 * 업로드 단(ecount-import-panel)과 «진행 중» 목록이 같이 쓴다.
 */
export function EcountOutline({ outline }: { outline: SheetOutline[] }) {
  return (
    <ul className="space-y-1">
      {outline.map((s, i) => (
        <li key={`${i}-${s.name}`} className="text-t10h text-ink-dim">
          <span className="font-semibold text-ink">{s.name}</span>
          {' · '}
          {s.rows.toLocaleString('ko-KR')}행 · {s.cols}열
          {' · '}
          {s.period ? `${s.period.from} ~ ${s.period.to}` : '기간 표기 없음'}
          {' · '}
          {s.unit ? `단위 ${UNIT_LABEL_KO[s.unit]}` : '단위 표기 없음'}
          {s.errorCells > 0 ? <span className="text-warning"> · 읽지 못한 칸 {s.errorCells.toLocaleString('ko-KR')}개</span> : null}
        </li>
      ))}
    </ul>
  )
}
