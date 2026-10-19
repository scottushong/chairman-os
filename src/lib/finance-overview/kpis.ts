import { computeCalendar, computeDaily, receivableAging } from './cash-days'
import { addMonths, computeBs, computeCash, computeDebt, computePl, computeSales, growth, monthsOfYear, pct, type Ctx } from './engine'
import { eok, pctText, ppText } from './format'

/**
 * 12가지 지표(시안 ⑧) — 칸마다 숫자 + «→ 판단 한 줄» + 초록(괜찮음) · 주황(살펴볼 것) · 빨강(조치 필요).
 * 기준값은 settings.ts(fin_kpi_settings). 계산하지 못한 지표는 빈칸이 아니라 «자료 부족: 무엇이 필요한지».
 */

export type Tone = 'good' | 'warn' | 'bad' | 'none'
export interface Kpi {
  no: number
  title: string
  value: string
  aside: string | null
  asideTone: 'up' | 'down' | 'muted'
  detail: string
  question: string
  answer: string
  tone: Tone
  /** 자료 부족이면 무엇이 필요한지 */
  need: string | null
}

const lack = (no: number, title: string, question: string, need: string): Kpi => ({ no, title, value: '자료 부족', aside: null, asideTone: 'muted', detail: `필요한 것: ${need}`, question, answer: '계산하지 못함', tone: 'none', need })

export function computeKpis(ctx: Ctx, period: string): Kpi[] {
  const s = ctx.settings
  const pl = computePl(ctx, period)
  const plPrev = computePl(ctx, addMonths(period, -1))
  const plLy = computePl(ctx, addMonths(period, -12))
  const bs = computeBs(ctx, period)
  const cash = computeCash(ctx, period, bs)
  const debt = computeDebt(ctx, period)
  const sales = computeSales(ctx, period, 1)
  const out: Kpi[] = []

  // 1 매출
  if (pl.revenue === null) out.push(lack(1, '매출', '장사가 커지는가, 줄어드는가', '판매현황 또는 계정별 원장'))
  else {
    const mom = growth(pl.revenue, plPrev.revenue)
    const yoy = growth(pl.revenue, plLy.revenue)
    const tone: Tone = mom === null && yoy === null ? 'none' : (mom ?? 0) >= 0 && (yoy ?? 0) >= 0 ? 'good' : (mom ?? 0) < -5 && (yoy ?? 0) < -5 ? 'bad' : 'warn'
    out.push({
      no: 1, title: '매출', value: eok(pl.revenue), aside: [mom !== null ? `전월 ${pctText(mom, 0)}` : null, yoy !== null ? `전년 ${pctText(yoy, 0)}` : null].filter(Boolean).join(' · ') || null, asideTone: (mom ?? 0) >= 0 ? 'up' : 'down',
      detail: [sales.topProduct ? `제품별 1위 ${sales.topProduct.name} ${eok(sales.topProduct.amount)}` : null, sales.rows[0] ? `거래처 1위 ${sales.rows[0].customer} ${eok(sales.rows[0].amount)}` : null].filter(Boolean).join(' · ') || '제품 · 거래처별은 판매현황이 있으면 보입니다',
      question: '장사가 커지는가, 줄어드는가', answer: mom === null ? '비교할 앞 달이 없음' : mom >= 0 ? '커지고 있음' : '줄어들고 있음', tone, need: null,
    })
  }

  // 2 이익
  if (pl.op === null || !pl.revenue) out.push(lack(2, '이익', '팔아서 남는가', '계정별 원장(또는 월별 손익계산서)'))
  else {
    const m = pct(pl.op, pl.revenue)!
    const pm = plPrev.op !== null && plPrev.revenue ? pct(plPrev.op, plPrev.revenue) : null
    const d = pm === null ? null : m - pm
    const tone: Tone = m < s.op_margin_bad ? 'bad' : m < s.op_margin_warn || (d !== null && d < -1) ? 'warn' : 'good'
    out.push({
      no: 2, title: '이익', value: `영업 ${eok(pl.op)}`, aside: `${m.toFixed(1)}%`, asideTone: 'muted',
      detail: `매출총이익 ${eok(pl.gross)}(${pct(pl.gross, pl.revenue)!.toFixed(1)}%) · 당기순이익 ${eok(pl.net)}(${pct(pl.net, pl.revenue)!.toFixed(1)}%)${pm !== null ? ` · 영업이익률 전월 ${pm.toFixed(1)}%` : ''}`,
      question: '팔아서 남는가', answer: pl.op < 0 ? '팔수록 손해 — 원가 · 판관비를 볼 것' : d === null ? '남고 있음' : d < 0 ? `남지만 이익률이 ${Math.abs(d).toFixed(1)}p 줄었음` : `남고 이익률이 ${d.toFixed(1)}p 늘었음`, tone, need: null,
    })
  }

  // 3 예상 실적(연말까지)
  const year = monthsOfYear(period).map((p) => computePl(ctx, p))
  const done = year.filter((r) => r.revenue !== null)
  if (done.length < 2) out.push(lack(3, '예상 실적 (연말까지)', '목표 달성 가능한가', '올해 두 달 이상의 손익(계정별 원장)'))
  else {
    const ytdRev = done.reduce((a, r) => a + (r.revenue ?? 0), 0)
    const ytdOp = done.reduce((a, r) => a + (r.op ?? 0), 0)
    const last3 = done.slice(-3)
    const left = 12 - Number(period.slice(5, 7))
    const fRev = ytdRev + (last3.reduce((a, r) => a + (r.revenue ?? 0), 0) / last3.length) * left
    const fOp = ytdOp + (last3.reduce((a, r) => a + (r.op ?? 0), 0) / last3.length) * left
    const rt = s.annual_revenue_target
    const ot = s.annual_op_target
    const rp = rt ? (fRev / rt) * 100 : null
    const op = ot ? (fOp / ot) * 100 : null
    const tone: Tone = rp === null && op === null ? 'none' : Math.min(rp ?? 100, op ?? 100) >= 95 ? 'good' : Math.min(rp ?? 100, op ?? 100) >= 85 ? 'warn' : 'bad'
    out.push({
      no: 3, title: '예상 실적 (연말까지)', value: `매출 ${eok(fRev, 0)}`, aside: rt ? `목표 ${eok(rt, 0)} · ${rp!.toFixed(0)}%` : '목표 없음', asideTone: 'muted',
      detail: `영업이익 전망 ${eok(fOp)}${ot ? ` (목표 ${eok(ot)} · ${op!.toFixed(0)}%)` : ''} · 1~${Number(period.slice(5, 7))}월 실적 + 최근 ${last3.length}개월 평균 × 남은 ${left}개월`,
      question: '목표 달성 가능한가', answer: rp === null && op === null ? '목표가 없음 — 기준값에 올해 목표를 넣으면 판단' : `${rp === null ? '' : rp >= 95 ? '매출은 근접' : '매출은 미달'}${rp !== null && op !== null ? ', ' : ''}${op === null ? '' : op >= 95 ? '이익도 근접' : '이익은 미달 예상'}`, tone, need: null,
    })
  }

  // 4 원가
  if (pl.cogs === null || !pl.revenue) out.push(lack(4, '원가', '원가가 오르고 있는가', '계정별 원장 · 재고금액명세서'))
  else {
    const r = pct(pl.cogs, pl.revenue)!
    const rp = plPrev.cogs !== null && plPrev.revenue ? pct(plPrev.cogs, plPrev.revenue) : null
    const d = rp === null ? null : r - rp
    const b = pl.cogsBasis
    const tone: Tone = d === null ? 'none' : d >= s.cogs_ratio_bad ? 'bad' : d >= s.cogs_ratio_warn ? 'warn' : 'good'
    const parts = [b.rawShare !== null ? `원재료 ${b.rawShare.toFixed(1)}%` : null, b.labor ? `노무 ${pct(b.labor, pl.revenue)!.toFixed(1)}%` : null, b.overhead ? `경비 ${pct(b.overhead, pl.revenue)!.toFixed(1)}%` : null].filter(Boolean)
    out.push({
      no: 4, title: '원가', value: `원가율 ${r.toFixed(1)}%`, aside: d === null ? null : `전월 ${ppText(d)}`, asideTone: d !== null && d > 0 ? 'down' : 'up',
      detail: `${parts.join(' · ') || '원가 구성은 계정이 나뉘어 있으면 보입니다'} · ${b.method === 'inventory' ? '재고 반영' : '장부 원가'}`,
      question: '원가가 오르고 있는가', answer: d === null ? '비교할 앞 달이 없음' : d > 0.2 ? (b.rawShare !== null && b.rawShare > 40 ? '원료가 밀어 올리고 있음' : '오르고 있음') : d < -0.2 ? '내려가고 있음' : '그대로', tone, need: null,
    })
  }

  // 5 · 6 제품 · 거래처 수익성 — 제품 원가가 이 화면 입력에 없다(원가 엔진 «제품 원가»는 원가 관리 · 대표 화면).
  out.push(lack(5, '제품 수익성', '무엇을 밀고 무엇을 접을지', '제품별 원가(원가 관리 «제품 원가») + 판매현황 제품별 매출'))
  out.push(lack(6, '거래처 수익성', '누가 돈이 되는 손님인가', '거래처별 판매 제품 · 제품 원가(원가 관리) · 물류비 · 할인'))

  // 7 현금
  const daily = computeDaily(ctx)
  const cashNow = daily.totalConverted ?? cash.closing
  if (cashNow === null) out.push(lack(7, '현금', '돈이 돌아가는가', '월별 자금흐름표(계좌 · 잔액) 또는 장부 현금 계정'))
  else {
    const opcf = cash.operating
    const tone: Tone = opcf !== null && opcf < 0 ? 'bad' : (cash.net ?? 0) < 0 ? 'warn' : 'good'
    out.push({
      no: 7, title: '현금', value: eok(cashNow), aside: daily.totalUsd ? `원 ${eok(daily.totalKrw ?? 0)} + $${(daily.totalUsd / 10_000).toFixed(1)}만` : null, asideTone: 'muted',
      detail: cash.hasFlows ? `이달 들어온 돈 ${eok(cash.inflow)} · 나간 돈 ${eok(cash.outflow)} · 순증 ${eok(cash.net, 1, true)} · 영업현금흐름 ${eok(opcf, 1, true)}` : '자금흐름표가 있으면 들어온 돈 · 나간 돈이 보입니다',
      question: '돈이 돌아가는가', answer: opcf === null ? '흐름 자료 없음' : opcf < 0 ? '영업에서 돈이 빠지고 있음' : (cash.net ?? 0) < 0 ? '영업에선 들어오고, 투자 · 상환으로 나감' : '잘 돌아가고 있음', tone, need: null,
    })
  }

  // 8 자금 전망(3개월)
  const cal = computeCalendar(ctx, ctx.today.slice(0, 7))
  const lows = cal.forecast.filter((f) => f.low !== null)
  if (!lows.length) out.push(lack(8, '자금 전망 (3개월)', '모자랄 때가 오는가', '자금흐름표(잔액 · 예정 줄) 또는 최근 3개월 실제 흐름'))
  else {
    const min = lows.reduce((a, f) => (f.low! < a.low! ? f : a))
    const safe = cal.safety.value
    const tone: Tone = safe === null ? 'none' : min.low! < safe ? 'bad' : min.low! < safe * 1.2 ? 'warn' : 'good'
    out.push({
      no: 8, title: '자금 전망 (3개월)', value: `최저 잔액 ${eok(min.low)}`, aside: `${Number(min.period.slice(5, 7))}월${min.estimated ? '(추정)' : ''}`, asideTone: tone === 'good' ? 'muted' : 'down',
      detail: `${cal.forecast.map((f) => `${Number(f.period.slice(5, 7))}월 ${eok((f.inflow ?? 0) - (f.outflow ?? 0), 1, true)}${f.estimated ? '(추정)' : ''}`).join(' · ')} · 안전선 ${safe === null ? '없음' : eok(safe)}${cal.safety.from === 'average' ? '(한 달 평균 지출)' : ''}`,
      question: '모자랄 때가 오는가', answer: safe === null ? '안전선을 정하면 판단' : min.low! < safe ? `${Number(min.period.slice(5, 7))}월에 안전선 아래 — 수금 당기기 · 지출 미루기` : min.low! < safe * 1.2 ? `${Number(min.period.slice(5, 7))}월에 바짝 붙음` : '여유 있음', tone, need: null,
    })
  }

  // 9 매출채권
  if (bs.receivable === null && daily.sales.receivable === null) out.push(lack(9, '매출채권', '받을 돈이 잘 들어오는가', '장부 외상매출금(재무상태) 또는 원장 거래 줄'))
  else {
    const ar = bs.receivable ?? daily.sales.receivable!
    const dso = daily.sales.dso
    const aging = receivableAging(ctx, ctx.today, s.overdue_days)
    const overShare = aging && ar ? (aging.overdue / ar) * 100 : null
    const tone: Tone = (dso !== null && dso >= s.dso_bad) || (overShare !== null && overShare >= 10) ? 'bad' : (dso !== null && dso >= s.dso_warn) || (overShare !== null && overShare >= 5) ? 'warn' : dso === null && overShare === null ? 'none' : 'good'
    out.push({
      no: 9, title: '매출채권', value: `미수 ${eok(ar)}`, aside: dso === null ? null : `회수 ${dso}일`, asideTone: 'muted',
      detail: aging ? `${s.overdue_days}일 초과 ${eok(aging.overdue)}${aging.byCustomer.length ? ` (${aging.byCustomer.slice(0, 3).map((c) => `${c.customer} ${(c.amount / 1e8).toFixed(1)}`).join(' · ')})` : ''}` : `연체(${s.overdue_days}일 초과)는 원장 거래 줄(외상매출금 · 거래처)이 있으면 보입니다`,
      question: '받을 돈이 잘 들어오는가', answer: tone === 'bad' ? `연체가 많음${aging?.byCustomer[0] ? `, ${aging.byCustomer[0].customer} 독촉 필요` : ''}` : tone === 'warn' ? '회수가 늦어지는 중' : tone === 'good' ? '잘 들어오고 있음' : '판단 자료 부족', tone, need: null,
    })
  }

  // 10 재고
  const inv = bs.inventory
  if (inv.total === null) out.push(lack(10, '재고', '돈이 창고에 묶여 있는가', '재고금액명세서 · 재공품 · 완제품 평가'))
  else {
    const days = pl.cogs ? Math.round(inv.total / (pl.cogs / 30)) : null
    const tone: Tone = days === null ? 'none' : days >= s.inventory_days_bad ? 'bad' : days >= s.inventory_days_warn ? 'warn' : 'good'
    out.push({
      no: 10, title: '재고', value: eok(inv.total), aside: days === null ? null : `재고일수 ${days}일`, asideTone: 'muted',
      detail: `원재료 ${inv.raw === null ? '—' : (inv.raw / 1e8).toFixed(1)} · 재공 ${inv.wip === null ? '—' : (inv.wip / 1e8).toFixed(1)} · 완제품 ${inv.finished === null ? '—' : (inv.finished / 1e8).toFixed(1)}(억)${inv.raw === null ? ' · 원재료 합계는 감춤(원료 3가지 미만) 또는 없음' : ''}`,
      question: '돈이 창고에 묶여 있는가', answer: days === null ? '원가가 없어 일수를 못 냄' : days >= s.inventory_days_warn ? '많이 묶여 있음 — 소진 계획 확인' : '적정', tone, need: null,
    })
  }

  // 11 차입금
  if (debt.total === null) out.push(lack(11, '차입금', '빚이 감당되는가', '대출현황 · 차입금'))
  else {
    const ratio = bs.totalLiabilities !== null && bs.equity ? (bs.totalLiabilities / bs.equity) * 100 : null
    const cover = pl.op !== null && debt.monthlyInterest ? pl.op / debt.monthlyInterest : null
    const tone: Tone = (cover !== null && cover < s.interest_cover_bad) || (ratio !== null && ratio >= s.debt_ratio_bad) ? 'bad' : (cover !== null && cover < s.interest_cover_warn) || (ratio !== null && ratio >= s.debt_ratio_warn) ? 'warn' : 'good'
    const nm = debt.nextMaturity
    out.push({
      no: 11, title: '차입금', value: eok(debt.total), aside: debt.monthlyInterest ? `월 이자 ${Math.round(debt.monthlyInterest / 10_000).toLocaleString('ko-KR')}만` : null, asideTone: 'muted',
      detail: [ratio !== null ? `부채비율 ${ratio.toFixed(0)}%` : null, cover !== null ? `이자보상배율 ${cover.toFixed(1)}배` : null, nm ? `다음 만기 ${nm.maturity!.slice(0, 7)} ${nm.lender} ${eok(nm.balance, 0)}` : null].filter(Boolean).join(' · ') || '부채비율 · 이자보상배율은 재무상태 · 손익이 있으면 보입니다',
      question: '빚이 감당되는가', answer: tone === 'bad' ? '이자 · 부채가 무거움 — 상환 계획 필요' : tone === 'warn' ? '감당은 되지만 살펴볼 것' : `이자는 충분히 감당${nm ? ', 만기 연장만 챙기면 됨' : ''}`, tone, need: null,
    })
  }

  // 12 투자 여력
  if (!lows.length) out.push(lack(12, '투자 여력', '새 설비 · 사업에 얼마나 쓸 수 있나', '자금 전망(자금흐름표) · 안전선 잔액'))
  else {
    const min = Math.min(...lows.map((f) => f.low!))
    const safe = cal.safety.value
    if (safe === null) out.push(lack(12, '투자 여력', '새 설비 · 사업에 얼마나 쓸 수 있나', '기준값 «안전선 잔액»'))
    else {
      const room = min - safe + s.unused_credit
      const yearlyOp = cash.operating !== null ? cash.operating * 12 : null
      const tone: Tone = room <= 0 ? 'bad' : room < safe * 0.3 ? 'warn' : 'good'
      out.push({
        no: 12, title: '투자 여력', value: room > 0 ? `약 ${eok(room, 0)}` : '없음', aside: '안전선 지키고 쓸 수 있는 돈', asideTone: 'muted',
        detail: `= 3개월 최저 잔액 ${eok(min)} − 안전선 ${eok(safe)} + 쓰지 않은 한도 ${eok(s.unused_credit)}${yearlyOp !== null ? ` · 연 영업현금(이 달 × 12) ${eok(yearlyOp, 0)}` : ''}`,
        question: '새 설비 · 사업에 얼마나 쓸 수 있나', answer: room > 0 ? `${eok(room, 0)} 안에서, 그 이상은 차입 필요` : '지금은 여력 없음 — 안전선부터', tone, need: null,
      })
    }
  }
  return out
}
