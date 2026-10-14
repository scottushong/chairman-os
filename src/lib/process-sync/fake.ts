/**
 * 가짜 시트 (0071) — dummy 화면과 check:process-sync가 쓴다. 진짜 구글을 부르지 않는다.
 *
 * 줄은 지어낸 업무다(실존 인물 · 거래처 없음). 일부러 틀린 줄을 섞어 화면에서 경고가 어떻게 보이는지 볼 수 있게 했다:
 *   ID 없음 · 날짜 틀림 · 상태 낱말 틀림 · 담당자 못 찾음.
 * 날짜는 오늘 기준으로 만든다 — 캘린더 이번 달에 늘 보이게.
 */
import type { ProcessSheetReader } from './run'

export const DUMMY_SHEET_IDS = {
  sales: 'dummy-sales-sheet-00000000001',
  support: 'dummy-support-sheet-0000000001',
} as const

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10)
}

const HEADER = ['ID', '단계', '업무명', '담당자 이메일', '시작일', '마감일', '상태', '비고']

export function fakeSheetValues(sheetId: string): string[][] | null {
  if (sheetId === DUMMY_SHEET_IDS.sales) {
    return [
      ['DY 영업 업무 프로세스(가짜)'],
      HEADER,
      ['S-01', '리드 접수', '신규 문의 정리', 'sales.staff@dy.example', day(-2), day(1), '진행', ''],
      ['S-02', '견적', '견적서 초안 작성', 'sales.lead@dy.example', day(0), day(3), '예정', '샘플 단가 확인'],
      ['S-03', '계약', '계약서 검토 요청', 'sales.staff2@dy.example', '', day(7), '예정', ''],
      ['S-04', '사후', '납품 후 만족도 확인', 'nobody@dy.example', '', day(12), '대기', '상태 낱말 틀림 · 담당자 없음'],
      ['', '리드 접수', 'ID 빠진 줄', 'sales.staff@dy.example', day(0), day(2), '예정', ''],
      ['S-06', '견적', '날짜 틀린 줄', 'sales.lead@dy.example', '10월 둘째 주', day(5), '예정', ''],
      ['S-07', '계약', '보류된 계약', '', '', '', '보류', ''],
    ]
  }
  if (sheetId === DUMMY_SHEET_IDS.support) {
    return [
      HEADER,
      ['M-01', '월 마감', '9월 전표 마감 점검', 'support.lead@dy.example', day(-1), day(2), '진행', ''],
      ['M-02', '세무', '부가세 자료 모으기', 'support.staff@dy.example', day(3), day(10), '예정', ''],
      ['M-03', '총무', '사무용품 재고 확인', 'support.staff@dy.example', '', '', '완료', ''],
    ]
  }
  return null
}

export function fakeSheetsReader(overrides: Record<string, string[][]> = {}): ProcessSheetReader {
  return {
    async readValues(sheetId) {
      const values = overrides[sheetId] ?? fakeSheetValues(sheetId)
      if (!values) throw new Error('시트를 찾지 못했습니다. 파일 ID를 확인하세요.')
      return values.map((r) => [...r])
    },
  }
}
