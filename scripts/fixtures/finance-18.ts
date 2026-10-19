/**
 * 0085 시험 · 스크린샷용 가짜 자료 — DY(biz_dy) 2026-09 한 달의 18가지 + 덧붙임 넷(8월 재고 · 8월 평가 · 10월 자금흐름표 · 원장 거래 줄 ·
 * 10월 세금계산서 · 재무제표(연간)). 전부 지어낸 값이다(진짜 회사 파일 아님 · 원료 이름은 «가짜 원료 …»).
 * 숫자는 시안(finance-overview-mock.html)의 크기에 맞췄다 — 매출 약 19.9억 · 재고 약 37억 · 차입 약 38.6억.
 */
import ExcelJS from 'exceljs'

type Cell = string | number | null
export interface Fixture {
  name: string
  bytes: Uint8Array
  /** 기대하는 종류(자료 표 종류 · legacy 셋 · 공식 결산 아님) */
  expect: string
  /** 18가지 체크표의 칸(없으면 덧붙임) */
  check?: string
}

async function xlsx(sheet: string, rows: Cell[][], name?: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheet)
  for (const r of rows) ws.addRow(r)
  void name
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const T = (t: string, ym: string, to = 30) => [`회사명 : (주)디와이 / ${ym.replace('-', '/')}/01 ~ ${ym.replace('-', '/')}/${to} / ${t}`]
const day = (ym: string, d: number) => `${ym}-${String(d).padStart(2, '0')}`

/** 매출 거래처 — 상위 넷 + 그 밖 27곳(합 862,375,160 · 301,900kg). */
function customers(): { c: string; p: string; kg: number; amt: number }[] {
  const top = [
    { c: 'A사', p: 'A-200', kg: 148_200, amt: 412_000_000 },
    { c: 'B사', p: 'B-110', kg: 101_300, amt: 298_500_000 },
    { c: 'C사 (베트남)', p: 'A-200', kg: 93_800, amt: 244_100_000 },
    { c: 'D사', p: 'C-050', kg: 60_100, amt: 176_000_000 },
  ]
  const rest: { c: string; p: string; kg: number; amt: number }[] = []
  let leftAmt = 862_375_160
  let leftKg = 301_900
  for (let i = 0; i < 27; i += 1) {
    const last = i === 26
    const amt = last ? leftAmt : Math.round(862_375_160 / 27 / 1000) * 1000 - (i % 5) * 1_000_000
    const kg = last ? leftKg : Math.round(301_900 / 27) - (i % 4) * 300
    rest.push({ c: `가짜 거래처 ${String(i + 1).padStart(2, '0')}`, p: ['A-200', 'B-110', 'C-050', 'D-300', 'E-010'][i % 5], kg, amt })
    leftAmt -= amt
    leftKg -= kg
  }
  return [...top, ...rest]
}

export const EXPECT = {
  revenue: 1_992_975_160,
  purchases: 1_205_600_000,
  rawClose: 1_725_316_455,
  rawOpen: 1_640_000_000,
  wip08: 560_000_000,
  fin08: 1_400_000_000,
  wip09: 581_051_000,
  fin09: 1_423_553_496,
  loans: 3_266_600_000,
  borrowing: 593_400_000,
}

/** 계정별 원장(9월) — 계정마다 한 덩어리(ECOUNT 모양). [코드, 이름, 차변, 대변] */
const LEDGER: [string, string, number, number][] = [
  ['1010', '현금및현금성자산', 2_086_000_000, 2_396_000_000],
  ['1080', '외상매출금', 1_992_975_160, 1_903_000_000],
  ['1530', '원재료', 1_205_600_000, 0],
  ['1400', '유형자산', 354_000_000, 0],
  ['2010', '외상매입금', 520_000_000, 1_205_600_000],
  ['2530', '미지급금', 40_000_000, 72_000_000],
  ['2600', '차입금', 42_000_000, 0],
  ['4010', '제품매출', 0, 1_992_975_160],
  ['4520', '제조인건비', 187_300_000, 0],
  ['4530', '전력비', 65_100_000, 0],
  ['4590', '기타제조경비', 100_000_000, 0],
  ['8010', '급여(판관)', 142_000_000, 0],
  ['8170', '복리후생비', 31_400_000, 0],
  ['8240', '운반비(판관)', 48_200_000, 0],
  ['8130', '해외시장개척비', 24_806_862, 0],
  ['8150', '수출입제비용', 18_480_849, 0],
  ['8190', '지급수수료', 44_600_000, 0],
  ['8250', '접대비', 9_210_500, 0],
  ['8210', '감가상각비', 18_700_000, 0],
  ['9010', '영업외수익', 0, 9_800_000],
  ['9310', '이자비용', 12_600_000, 0],
  ['9320', '외환차손', 5_500_000, 0],
]

/** 계정과목표(ECOUNT 모양) — 원장의 코드 전부 + 이름. 자동 생성 계정을 덮어쓰는지 본다. */
const CHART: [string, string, string][] = [
  ['1010', '현금및현금성자산', '자산'], ['1080', '외상매출금', '자산'], ['1400', '유형자산', '자산'], ['1410', '감가상각누계액', '자산'], ['1530', '원재료', '자산'],
  ['2010', '외상매입금', '부채'], ['2530', '미지급금', '부채'], ['2600', '차입금', '부채'], ['3310', '자본금', '자본'],
  ['4010', '제품매출', '수익'], ['4510', '원재료비', '비용'], ['4520', '제조인건비', '비용'], ['4530', '전력비', '비용'], ['4540', '운반비', '비용'], ['4550', '라이선스료', '비용'], ['4590', '기타제조경비', '비용'],
  ['8010', '급여(판관)', '비용'], ['8130', '해외시장개척비', '비용'], ['8150', '수출입제비용', '비용'], ['8170', '복리후생비', '비용'], ['8190', '지급수수료', '비용'], ['8210', '감가상각비', '비용'], ['8240', '운반비(판관)', '비용'], ['8250', '접대비', '비용'],
  ['9010', '영업외수익', '영업외수익'], ['9310', '이자비용', '영업외비용'], ['9320', '외환차손', '영업외비용'], ['9980', '법인세비용', '비용'],
]

/** 자금흐름표 줄 — 계좌 · 통화 · 잔액 · 예정. 잔액은 계좌마다 흐름을 따라 계산한다. */
interface Flow { d: string; acct: string; cur?: 'USD'; cat: string; inflow?: number; outflow?: number; planned?: boolean }
function cashRows(ym: string, flows: Flow[], opening: Record<string, number>): Cell[][] {
  const bal = { ...opening }
  const rows: Cell[][] = [T('월별 자금흐름표', ym, 31), ['일자', '계좌', '통화', '항목', '입금', '출금', '잔액', '실적/예정']]
  for (const [acct, v] of Object.entries(opening)) rows.push([day(ym, 1), acct, acct.includes('외화') ? 'USD' : 'KRW', '전월이월', null, null, v, '실적'])
  for (const f of [...flows].sort((a, b) => a.d.localeCompare(b.d))) {
    if (!f.planned) bal[f.acct] = (bal[f.acct] ?? 0) + (f.inflow ?? 0) - (f.outflow ?? 0)
    rows.push([f.d, f.acct, f.cur ?? 'KRW', f.cat, f.inflow ?? null, f.outflow ?? null, f.planned ? null : bal[f.acct], f.planned ? '예정' : '실적'])
  }
  return rows
}

const MAIN = '기업은행 주거래'
const OPS = '국민은행 운영'
const FX = '기업은행 외화'

function septemberFlows(): Flow[] {
  const ym = '2026-09'
  return [
    { d: day(ym, 2), acct: MAIN, cat: 'A사 8월분 수금', inflow: 410_000_000 },
    { d: day(ym, 3), acct: MAIN, cat: '원료 LOT 2609-01 대금', outflow: 260_000_000 },
    { d: day(ym, 5), acct: MAIN, cat: 'B사 수금', inflow: 300_000_000 },
    { d: day(ym, 8), acct: OPS, cat: '외주가공비', outflow: 50_000_000 },
    { d: day(ym, 10), acct: MAIN, cat: '급여', outflow: 290_000_000 },
    { d: day(ym, 11), acct: OPS, cat: '4대보험 · 세금', outflow: 80_000_000 },
    { d: day(ym, 12), acct: FX, cur: 'USD', cat: 'C사 수출대금', inflow: 42_000 },
    { d: day(ym, 15), acct: MAIN, cat: '설비 구입(코팅기)', outflow: 354_000_000 },
    { d: day(ym, 17), acct: MAIN, cat: '국민은행 운전자금 이자', outflow: 5_200_000 },
    { d: day(ym, 18), acct: MAIN, cat: 'D사 수금', inflow: 176_000_000 },
    { d: day(ym, 19), acct: MAIN, cat: '원료 LOT 2609-02 대금', outflow: 260_000_000 },
    { d: day(ym, 20), acct: OPS, cat: '전기 · 가스', outflow: 30_000_000 },
    { d: day(ym, 24), acct: MAIN, cat: '거래처 월말 수금', inflow: 1_017_000_000 },
    { d: day(ym, 25), acct: OPS, cat: '카드 결제', outflow: 70_000_000 },
    { d: day(ym, 25), acct: MAIN, cat: '기업은행 시설자금 원금 · 이자', outflow: 16_660_000 },
    { d: day(ym, 26), acct: OPS, cat: '임차 · 리스', outflow: 40_000_000 },
    { d: day(ym, 28), acct: MAIN, cat: '대표 차입 상환', outflow: 17_000_000 },
    { d: day(ym, 29), acct: OPS, cat: '경비 · 수수료', outflow: 95_000_000 },
  ]
}

function octoberFlows(): Flow[] {
  const ym = '2026-10'
  const f: Flow[] = [
    { d: day(ym, 1), acct: MAIN, cat: 'B사 9월분 수금', inflow: 210_000_000 },
    { d: day(ym, 2), acct: MAIN, cat: 'A사 9월분 수금', inflow: 128_000_000 },
    { d: day(ym, 5), acct: MAIN, cat: '원료 LOT 2610-01 대금', outflow: 166_200_000 },
    { d: day(ym, 6), acct: MAIN, cat: 'F사 수금', inflow: 150_000_000 },
    { d: day(ym, 8), acct: OPS, cat: '외주가공비', outflow: 48_000_000 },
    { d: day(ym, 10), acct: MAIN, cat: '급여', outflow: 292_000_000 },
    { d: day(ym, 13), acct: OPS, cat: '4대보험 · 세금', outflow: 81_000_000 },
    { d: day(ym, 14), acct: MAIN, cat: 'D사 수금', inflow: 186_000_000 },
    { d: day(ym, 15), acct: OPS, cat: '전기 · 가스', outflow: 31_000_000 },
    { d: day(ym, 16), acct: MAIN, cat: 'G사 수금', inflow: 60_000_000 },
    { d: day(ym, 17), acct: MAIN, cat: '국민은행 운전자금 이자', outflow: 5_200_000 },
    { d: day(ym, 19), acct: MAIN, cat: 'A사 9월분 수금', inflow: 128_000_000 },
    { d: day(ym, 19), acct: FX, cur: 'USD', cat: 'C사 수출대금', inflow: 42_000 },
    { d: day(ym, 19), acct: MAIN, cat: '원료 LOT 2610-03 대금', outflow: 166_200_000 },
    { d: day(ym, 19), acct: MAIN, cat: '기업은행 이자', outflow: 4_330_000 },
    // 앞날 — 예정(수금예정 · 지급예정)
    { d: day(ym, 21), acct: MAIN, cat: 'H사 수금예정', inflow: 90_000_000, planned: true },
    { d: day(ym, 22), acct: MAIN, cat: '원료 2차 지급예정', outflow: 120_000_000, planned: true },
    { d: day(ym, 24), acct: MAIN, cat: 'A사 · B사 월말 수금예정', inflow: 320_000_000, planned: true },
    { d: day(ym, 26), acct: OPS, cat: '카드 결제예정', outflow: 70_000_000, planned: true },
    { d: day(ym, 27), acct: MAIN, cat: '원료 3차 · 부자재 지급예정', outflow: 210_000_000, planned: true },
    { d: day(ym, 29), acct: OPS, cat: '임차 · 리스 지급예정', outflow: 40_000_000, planned: true },
  ]
  return f
}

/** 11 · 12월 예정(자금흐름표 «예정» 줄 — 같은 파일 11월 · 12월 시트로 따로 올린다). */
function futureFlows(ym: string, big: boolean): Flow[] {
  return [
    { d: day(ym, 2), acct: MAIN, cat: 'A사 수금예정', inflow: 128_000_000, planned: true },
    { d: day(ym, 6), acct: MAIN, cat: 'B사 수금예정', inflow: 210_000_000, planned: true },
    { d: day(ym, 5), acct: MAIN, cat: '원료 LOT 지급예정', outflow: 166_000_000, planned: true },
    { d: day(ym, 10), acct: MAIN, cat: big ? '급여 · 상여 지급예정' : '급여 지급예정', outflow: big ? 520_000_000 : 290_000_000, planned: true },
    { d: day(ym, 11), acct: OPS, cat: '4대보험 · 세금 지급예정', outflow: 80_000_000, planned: true },
    { d: day(ym, 13), acct: MAIN, cat: 'F사 수금예정', inflow: 150_000_000, planned: true },
    ...(big ? [{ d: day(ym, 24), acct: MAIN, cat: '부가세 납부예정', outflow: 210_000_000, planned: true } as Flow] : []),
    { d: day(ym, 24), acct: MAIN, cat: 'A사 · B사 월말 수금예정', inflow: 320_000_000, planned: true },
    { d: day(ym, 27), acct: MAIN, cat: '원료 3차 지급예정', outflow: big ? 380_000_000 : 210_000_000, planned: true },
  ]
}

export async function buildFinanceFixtures(): Promise<Fixture[]> {
  const ym = '2026-09'
  const cs = customers()
  const out: Fixture[] = []
  const add = async (name: string, expect: string, sheet: string, rows: Cell[][], check?: string) => out.push({ name, bytes: await xlsx(sheet, rows), expect, check })

  // ① 판매현황
  await add('2026_09_판매현황.xlsx', 'sales', '판매현황', [
    T('판매현황', ym),
    ['판매일자', '거래처명', '품목명', '판매수량', '단가', '공급가액'],
    ...cs.map((c, i) => [day(ym, 1 + (i % 28)), c.c, c.p, c.kg, Math.round(c.amt / c.kg), c.amt]),
    ['합계', null, null, cs.reduce((s, c) => s + c.kg, 0), null, EXPECT.revenue],
  ], 'sales')
  // ② 입고명세서 — 원료 셋(가짜 이름)
  await add('입고명세서_9월.xlsx', 'purchase_in', '입고명세서', [
    T('입고명세서', ym),
    ['입고일자', '자재명', '공급처', '자재구분', '입고수량', '입고금액'],
    [day(ym, 3), '가짜 원료 가', '가짜 공급처 갑', '원재료', 200_000, 520_000_000],
    [day(ym, 19), '가짜 원료 나', '가짜 공급처 을', '원재료', 180_000, 520_000_000],
    [day(ym, 25), '가짜 원료 다', '가짜 공급처 병', '원재료', 60_000, 165_600_000],
    ['합계', null, null, null, 440_000, EXPECT.purchases],
  ], 'purchase_in')
  // ③ 재고금액명세서 8월 · 9월(8월은 덧붙임 — 9월 기초)
  const inv = (m: string, opening: number[], closing: number[]) => [
    T('재고금액명세서', m),
    ['품목명', '사용수량', '기말재고수량', '기초재고금액', '기말재고금액'],
    ['가짜 원료 가', 190_000, 300_000, opening[0], closing[0]],
    ['가짜 원료 나', 170_000, 280_000, opening[1], closing[1]],
    ['가짜 원료 다', 55_000, 90_000, opening[2], closing[2]],
    ['합계', 415_000, 670_000, opening.reduce((a, b) => a + b, 0), closing.reduce((a, b) => a + b, 0)],
  ]
  await add('재고금액명세서_8월.xlsx', 'inventory', '재고금액명세서', inv('2026-08', [700_000_000, 600_000_000, 300_000_000], [720_000_000, 620_000_000, 300_000_000]))
  await add('재고금액명세서_9월.xlsx', 'inventory', '재고금액명세서', inv(ym, [720_000_000, 620_000_000, 300_000_000], [760_000_000, 650_316_455, 315_000_000]), 'inventory')
  // ④ 제조지시명세서
  await add('제조지시명세서_2609.xlsx', 'production', '제조지시명세서', [T('제조지시명세서', ym), ['생산품목', '생산수량', '비고'], ['A-200', 240_000, ''], ['원료 투입 · 가짜 원료 가', 190_000, '투입'], ['B-110', 110_000, ''], ['C-050', 70_000, ''], ['합계', 420_000, null]], 'production')
  // ⑤ 계정별 원장 — 계정마다 한 덩어리
  const led: Cell[][] = []
  for (const [code, name, dr, cr] of LEDGER) {
    led.push([`회사명 : (주)디와이 / 2026/09/01 ~ 2026/09/30 / 계정별원장 / ${code}(${name})`], ['일자-No.', '적요', '차변', '대변', '잔액'], ['이월잔액', null, null, null, 0], [day(ym, 30), `${name} 9월 합계`, dr, cr, dr - cr], ['합계', null, dr, cr, null])
  }
  out.push({ name: '9월 계정별 원장.xlsx', bytes: await xlsx('계정별원장', led), expect: 'ledger', check: 'ledger' })
  // ⑥ 급여대장 — 부서 여섯 · 개인 줄(이름 · 주민번호 · 계좌는 열 때 버린다)
  const depts = ['경영지원', '영업', '생산1', '생산2', '품질', '연구소']
  const pay: Cell[][] = [T('급여대장', ym), ['사번', '성명', '주민번호', '부서', '기본급', '상여', '퇴직급여', '계좌번호']]
  let payTotal = 0
  depts.forEach((d, i) => {
    for (let k = 0; k < 3; k += 1) {
      const v = 3_000_000 + i * 200_000 + k * 100_000
      payTotal += v
      pay.push([`E${i}${k}`, `가짜이름${i}${k}`, '900101-1234567', d, v, 0, 0, '110-123-456789'])
    }
  })
  pay.push(['합계', null, null, null, payTotal, 0, 0, null])
  await add('급여대장_2609.xlsx', 'payroll', '급여대장', pay, 'payroll')
  // ⑦ 수입 거래목록(OFFER) — 원료 셋
  await add('수입거래목록_OFFER_9월.xlsx', 'import', 'OFFER SHEET', [T('수입 거래목록 OFFER SHEET', ym), ['OFFER NO', 'ITEM', 'SHIPPER', '통화', 'AMOUNT', '환율', '원화금액', '부대비용'], ['OF-2609-1', '가짜 원료 가', '가짜 수출자 A', 'USD', 120_000, 1390, 166_800_000, 4_100_000], ['OF-2609-2', '가짜 원료 나', '가짜 수출자 B', 'USD', 90_000, 1392, 125_280_000, 3_200_000], ['OF-2609-3', '가짜 원료 다', '가짜 수출자 C', 'USD', 30_000, 1395, 41_850_000, 1_100_000], ['합계', null, null, null, 240_000, null, 333_930_000, 8_400_000]], 'import')
  // ⑧ 월별 자금흐름표 9월 · 10월 · 11월 · 12월(10월부터 예정 줄)
  const open9: Record<string, number> = { [MAIN]: 1_710_000_000, [OPS]: 795_000_000, [FX]: 276_420 }
  const s9 = septemberFlows()
  out.push({ name: '월별 자금흐름표_2026-09.xlsx', bytes: await xlsx('자금흐름표', cashRows(ym, s9, open9)), expect: 'cashflow', check: 'cashflow' })
  const end9 = { ...open9 }
  for (const f of s9) if (!f.planned) end9[f.acct] += (f.inflow ?? 0) - (f.outflow ?? 0)
  out.push({ name: '월별 자금흐름표_2026-10.xlsx', bytes: await xlsx('자금흐름표', cashRows('2026-10', octoberFlows(), end9)), expect: 'cashflow' })
  out.push({ name: '자금계획_2026-11.xlsx', bytes: await xlsx('자금흐름표', cashRows('2026-11', futureFlows('2026-11', false), {})), expect: 'cashflow' })
  out.push({ name: '자금계획_2026-12.xlsx', bytes: await xlsx('자금흐름표', cashRows('2026-12', futureFlows('2026-12', true), {})), expect: 'cashflow' })
  // ⑨ 법인카드 — 41건
  const card: Cell[][] = [T('법인카드 사용내역', ym), ['이용일', '가맹점', '사용부서', '카드번호', '이용금액']]
  let cardSum = 0
  for (let i = 0; i < 41; i += 1) {
    const v = 150_000 + (i % 7) * 20_500 + i * 1000
    cardSum += v
    card.push([day(ym, 1 + (i % 28)), `가짜 가맹점 ${i + 1}`, ['영업', '경영지원', '생산1'][i % 3], '1234-5678-9012-3456', v])
  }
  card.push(['합계', null, null, null, cardSum])
  out.push({ name: 'IMG_card_9월.xlsx', bytes: await xlsx('법인카드', card), expect: 'card', check: 'card' })
  // ⑩ 베트남 법인 운영비
  await add('베트남법인_운영비_9월.xlsx', 'overseas', '베트남 법인 운영비', [T('베트남 법인 운영비', ym), ['법인명', '항목', '통화', '외화금액', '환율', '원화금액'], ['DY VINA', '임차료', 'VND', 180_000_000, 0.055, 9_900_000], ['DY VINA', '현지 급여', 'VND', 320_000_000, 0.055, 17_600_000], ['합계', null, null, 500_000_000, null, 27_500_000]], 'overseas')
  // ⑪ 해외 판촉비
  await add('해외판촉비_9월.xlsx', 'promo', '해외 판촉비', [T('해외 판촉비', ym), ['담당자', '항목', '통화', '금액'], ['가짜 담당 김', '호치민 전시회', 'USD', 9_800], ['가짜 담당 이', '샘플 발송', 'USD', 3_200], ['합계', null, null, 13_000]], 'promo')
  // ⑫ 대출현황 — 총액 · 잔액 · 금리 · 만기 · 원금 · 이자 · 내는 날
  await add('대출현황_0930.xlsx', 'loans', '대출현황', [
    T('대출현황', ym),
    ['금융기관', '대출종류', '대출금액', '대출잔액', '금리', '만기일', '원금상환', '이자', '이자납입일'],
    ['기업은행', '시설자금', 2_000_000_000, 1_266_600_000, 4.1, '2029-06-30', 12_330_000, 4_330_000, 25],
    ['국민은행', '운전자금', 1_200_000_000, 1_200_000_000, 5.2, '2027-03-31', 0, 5_200_000, 17],
    ['신보 보증부', '운전자금', 800_000_000, 800_000_000, 4.6, '2027-11-30', 0, 3_070_000, 20],
    ['합계', null, 4_000_000_000, EXPECT.loans, null, null, 12_330_000, 12_600_000, null],
  ], 'loans')
  // ⑬ 차입금 — 대표 차입(누적)
  await add('26년 차입금.xlsx', 'borrowings', '차입금', [T('연도별 차입금', ym), ['일자', '차입처', '구분', '금액', '입금방법'], ['2026-09-01', '대표 차입', '차입', 610_400_000, '직접 입금'], ['2026-09-28', '대표 차입', '상환', 17_000_000, '직접 입금'], ['합계', null, null, 627_400_000, null]], 'borrowings')
  // ⑭ 절감목표 · 진행
  await add('절감목표 및 진행현황.xlsx', 'savings', '절감목표 및 진행현황', [T('절감목표 및 진행현황', ym), ['항목', '기존인건비', '절감목표', '절감실적'], ['공정 자동화', 120_000_000, 30_000_000, 21_000_000], ['외주 정리', 40_000_000, 10_000_000, 6_500_000]], 'savings')
  // ⑮ 계정과목표(ECOUNT)
  await add('계정과목표_DY.xlsx', 'accounts', '계정과목', [['계정과목 목록'], ['회사 : DY'], [null, null, null, '(단위 : 원)'], ['코드', '계정명', '구분', '사용여부'], ...CHART.map(([c, n, g]) => [c, n, g, '사용'])], 'accounts')
  // ⑯ 월별 손익계산서(ECOUNT) — 9월만(재고 반영은 앱이: 원재료비 줄 없음)
  await add('월별손익계산서_2026.xlsx', 'monthly', '월별손익', [
    ['월별 손익계산서'],
    ['2026/01/01 ~ 2026/12/31'],
    [null, null, null, '(단위 : 원)'],
    ['계정코드', '과목명', '9월', '합계'],
    [null, 'Ⅰ. 매출액', EXPECT.revenue, EXPECT.revenue],
    ['4010', '제품매출', EXPECT.revenue, EXPECT.revenue],
    [null, 'Ⅱ. 매출원가', 352_400_000, 352_400_000],
    ['4520', '제조인건비', 187_300_000, 187_300_000],
    ['4530', '전력비', 65_100_000, 65_100_000],
    ['4590', '기타제조경비', 100_000_000, 100_000_000],
    [null, 'Ⅲ. 매출총이익', EXPECT.revenue - 352_400_000, EXPECT.revenue - 352_400_000],
    [null, 'Ⅳ. 판매비와관리비', 337_398_211, 337_398_211],
    ['8010', '급여(판관)', 142_000_000, 142_000_000],
    ['8170', '복리후생비', 31_400_000, 31_400_000],
    ['8240', '운반비(판관)', 48_200_000, 48_200_000],
    ['8130', '해외시장개척비', 24_806_862, 24_806_862],
    ['8150', '수출입제비용', 18_480_849, 18_480_849],
    ['8190', '지급수수료', 44_600_000, 44_600_000],
    ['8250', '접대비', 9_210_500, 9_210_500],
    ['8210', '감가상각비', 18_700_000, 18_700_000],
    [null, 'Ⅴ. 영업이익', EXPECT.revenue - 352_400_000 - 337_398_211, EXPECT.revenue - 352_400_000 - 337_398_211],
    [null, 'Ⅵ. 영업외수익', 9_800_000, 9_800_000],
    ['9010', '영업외수익', 9_800_000, 9_800_000],
    [null, 'Ⅶ. 영업외비용', 18_100_000, 18_100_000],
    ['9310', '이자비용', 12_600_000, 12_600_000],
    ['9320', '외환차손', 5_500_000, 5_500_000],
    [null, 'Ⅷ. 당기순이익', EXPECT.revenue - 352_400_000 - 337_398_211 + 9_800_000 - 18_100_000, EXPECT.revenue - 352_400_000 - 337_398_211 + 9_800_000 - 18_100_000],
  ], 'pl_monthly')
  // ⑰ 재공품 · 완제품 평가 8월 · 9월
  const val = (m: string, wip: number, fin: number) => [T('재공품 · 완제품 평가', m), ['재고구분', '평가금액', '평가기준일', '평가방법', '포함원가범위', '비고'], ['재공품', wip, `${m}-30`, '월 가중평균', '재료비+노무비+경비', ''], ['완제품', fin, `${m}-30`, '월 가중평균', '재료비+노무비+경비', '']]
  await add('재공품_완제품_평가_8월.xlsx', 'valuation', '재공품 완제품 평가', val('2026-08', EXPECT.wip08, EXPECT.fin08))
  await add('재공품_완제품_평가_9월.xlsx', 'valuation', '재공품 완제품 평가', val(ym, EXPECT.wip09, EXPECT.fin09), 'valuation')
  // ⑲ 출하집계표
  await add('출하집계표_9월.xlsx', 'shipment', '출하집계표', [T('출하집계표', ym), ['출하일자', '거래처명', '품목명', '출하량', '출하금액'], ...cs.map((c, i) => [day(ym, 1 + (i % 28)), c.c, c.p, c.kg, c.amt]), ['합계', null, null, cs.reduce((s, c) => s + c.kg, 0), EXPECT.revenue]], 'shipment')

  // 덧붙임 — 원장 거래 줄(외상매출금 · 거래처 — 연체 계산) · 10월 세금계산서(이달 매출) · 재무제표(연간 ECOUNT)
  const arLines: Cell[][] = [T('일반전표 전표내역', ym), ['전표일자', '계정코드', '계정과목', '거래처명', '적요', '차변', '대변']]
  const ar: [string, string, number, number][] = [
    ['2026-07-10', 'G사', 180_000_000, 0], ['2026-07-20', 'K사', 90_000_000, 0], ['2026-08-05', 'M사', 40_000_000, 0], ['2026-08-12', 'A사', 410_000_000, 0], ['2026-09-02', 'A사', 0, 410_000_000],
    ['2026-09-10', 'A사', 412_000_000, 0], ['2026-09-12', 'B사', 298_500_000, 0], ['2026-09-15', 'C사 (베트남)', 244_100_000, 0], ['2026-09-18', 'D사', 176_000_000, 0], ['2026-09-18', 'D사', 0, 176_000_000], ['2026-09-24', '가짜 거래처 01', 31_000_000, 0], ['2026-09-26', 'H사', 60_000_000, 0], ['2026-09-27', 'F사', 150_000_000, 0], ['2026-09-28', '가짜 거래처 02', 30_000_000, 0], ['2026-09-29', '가짜 거래처 03', 28_000_000, 0],
  ]
  for (const [d, c, dr, cr] of ar) arLines.push([d, '1080', '외상매출금', c, dr ? '제품 매출' : '수금', dr || null, cr || null])
  await add('전표내역_7~9월.xlsx', 'ledger_lines', '전표내역', arLines)
  await add('매출 세금계산서 10월.xlsx', 'tax_invoice', '매출 세금계산서', [T('전자세금계산서 매출', '2026-10', 19), ['작성일자', '상호', '품목명', '공급가액', '세액', '합계금액'], ['2026-10-05', 'A사', 'A-200', 412_000_000, 41_200_000, 453_200_000], ['2026-10-09', 'B사', 'B-110', 298_400_000, 29_840_000, 328_240_000], ['2026-10-14', 'D사', 'C-050', 176_000_000, 17_600_000, 193_600_000], ['2026-10-17', 'F사', 'A-200', 300_000_000, 30_000_000, 330_000_000], ['합계', null, null, 1_186_400_000, 118_640_000, 1_305_040_000]])
  return out
}

/** 순서를 섞는다(같은 씨앗 = 같은 순서 — 시험이 다시 돌아도 같게). */
export function shuffle<T>(xs: T[], seed = 85): T[] {
  const a = [...xs]
  let s = seed
  for (let i = a.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
