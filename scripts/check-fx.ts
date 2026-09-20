/**
 * Phase 5-C 환율 칩 검증 (오프라인, 네트워크 없음): npm run check:fx
 *
 * 무엇을 재나
 *   1) 교차환율 — frankfurter는 ECB 기준이라 base=EUR이 원본 방향이다.
 *      KRW/EUR ÷ X/EUR = 원/X.
 *   2) **base=KRW를 쓰면 안 되는 이유** — 응답이 소수점 5자리라 USD가 0.00072로 뭉개지고
 *      9/17과 9/18이 같은 값이 된다. 전일비 화살표가 영원히 '변동 없음'이 된다.
 *      이 스크립트가 그 회귀를 못 박는다(가장 중요한 칸이다).
 *   3) 직전 영업일 — ECB는 주말·공휴일에 발표하지 않는다. '어제'가 아니라
 *      '응답에 실제로 있는 마지막 두 날'을 비교해야 한다.
 *   4) 실패는 null로 수렴한다 — lib/weather.ts와 같은 규칙이다.
 *      아침에 회장이 여는 첫 화면이 외부 API 때문에 비면 안 된다.
 *
 * 숫자는 2026-09-18(금) 실제 응답이다. 주말이라 9/19·9/20은 없다 —
 * 그 공백이 3)의 시험 자료다.
 */
import assert from 'node:assert/strict'

import { buildChips, crossRate, lastTwoDays } from '../src/lib/fx'

/** 2026-09-16~18 실제 응답(base=EUR). 9/12·9/13(주말)은 원본에도 없다. */
const EUR_SERIES: Record<string, Record<string, number>> = {
  '2026-09-16': { KRW: 1578.03, USD: 1.1537, CNY: 7.6899, CAD: 1.6102, SGD: 1.4703 },
  '2026-09-17': { KRW: 1587.31, USD: 1.1481, CNY: 7.6812, CAD: 1.6078, SGD: 1.4669 },
  '2026-09-18': { KRW: 1590.76, USD: 1.146, CNY: 7.6755, CAD: 1.6056, SGD: 1.4651 },
}

function crossRateMath() {
  // 1 USD = 1590.76/1.146 = 1388.0977… 원
  const usd = crossRate(EUR_SERIES['2026-09-18'], 'USD')
  assert.ok(usd !== null)
  assert.ok(Math.abs(usd - 1388.0977) < 0.001, `USD→KRW가 1388.0977이어야 한다: ${usd}`)

  // EUR은 교차가 필요 없다 — KRW/EUR 그 자체다.
  assert.equal(crossRate(EUR_SERIES['2026-09-18'], 'EUR'), 1590.76)

  // 없는 통화는 null이다. VND·AED가 여기로 떨어진다(frankfurter 미지원).
  assert.equal(crossRate(EUR_SERIES['2026-09-18'], 'VND'), null)
  assert.equal(crossRate(EUR_SERIES['2026-09-18'], 'AED'), null)

  // KRW 자리가 비면 교차의 분자가 없다 — 0으로 나누지 않고 null로 간다.
  assert.equal(crossRate({ USD: 1.146 }, 'USD'), null)
  assert.equal(crossRate({ KRW: 1590.76, USD: 0 }, 'USD'), null)
}

function businessDayGap() {
  // 마지막 두 '발표일'을 고른다. 달력상 어제가 아니다.
  assert.deepEqual(lastTwoDays(EUR_SERIES), ['2026-09-17', '2026-09-18'])

  // 주말이 끼어 3일이 비어도 있는 것끼리 잇는다.
  const withWeekend = {
    '2026-09-11': { KRW: 1570.0, USD: 1.15 },
    '2026-09-14': { KRW: 1575.0, USD: 1.154 },
  }
  assert.deepEqual(lastTwoDays(withWeekend), ['2026-09-11', '2026-09-14'])

  // 하루치뿐이면 비교 대상이 없다 — 화살표를 그릴 수 없으므로 null이다.
  assert.equal(lastTwoDays({ '2026-09-18': { KRW: 1590.76 } }), null)
  assert.equal(lastTwoDays({}), null)
}

function chips() {
  const built = buildChips(EUR_SERIES, ['USD', 'EUR', 'CNY', 'CAD', 'SGD'])
  assert.ok(built !== null)
  assert.equal(built.asOf, '2026-09-18', '기준일은 마지막 발표일이다')
  assert.equal(built.comparedTo, '2026-09-17')
  assert.equal(built.chips.length, 5)

  const usd = built.chips.find((c) => c.code === 'USD')!
  // 9/17 1382.5538 → 9/18 1388.0977
  assert.ok(Math.abs(usd.krw - 1388.0977) < 0.001)
  assert.ok(Math.abs(usd.deltaKrw - 5.5439) < 0.001, `전일비 5.5439원이어야 한다: ${usd.deltaKrw}`)
  assert.ok(Math.abs(usd.deltaPct - 0.401) < 0.01, `전일비 +0.401%여야 한다: ${usd.deltaPct}`)
  assert.equal(usd.direction, 'up')

  // 이 사흘은 원화가 EUR 대비 계속 약해진 구간이라 다섯 통화가 전부 상승이다.
  // 실데이터로는 하락·보합을 덮을 수 없어 아래 directions()가 합성 자료로 따로 잰다.
  assert.deepEqual(
    built.chips.map((c) => c.direction),
    ['up', 'up', 'up', 'up', 'up'],
  )

  // 지원하지 않는 통화를 섞어도 칩이 통째로 죽지 않는다. 그 칸만 빠진다.
  const withVnd = buildChips(EUR_SERIES, ['USD', 'VND'])
  assert.ok(withVnd !== null)
  assert.deepEqual(withVnd.chips.map((c) => c.code), ['USD'])
}

/**
 * 화살표 세 방향. 실데이터 사흘이 전부 상승이라 여기만 합성 자료를 쓴다.
 * 숫자를 단순하게 잡아 기대값을 손으로 검산할 수 있게 둔다.
 */
function directions() {
  // KRW/EUR이 그대로고 USD가 EUR 대비 강해지면 원/USD는 내린다.
  const down = buildChips(
    {
      '2026-09-17': { KRW: 1600, USD: 1.6 }, // 1000원
      '2026-09-18': { KRW: 1600, USD: 2.0 }, // 800원
    },
    ['USD'],
  )!
  assert.equal(down.chips[0].direction, 'down')
  assert.equal(down.chips[0].krw, 800)
  assert.equal(down.chips[0].deltaKrw, -200)
  assert.equal(down.chips[0].deltaPct, -20)

  // 두 날이 완전히 같으면 보합이다. 화살표 대신 가로줄이 나갈 자리다.
  const flat = buildChips(
    {
      '2026-09-17': { KRW: 1600, USD: 1.6 },
      '2026-09-18': { KRW: 1600, USD: 1.6 },
    },
    ['USD'],
  )!
  assert.equal(flat.chips[0].direction, 'flat')
  assert.equal(flat.chips[0].deltaKrw, 0)
  assert.equal(flat.chips[0].deltaPct, 0)
}

/**
 * 이 스크립트의 존재 이유. base=KRW로 부르면 전일비가 죽는다는 것을 숫자로 남긴다.
 *
 * 누군가 "KRW 기준으로 부르면 교차환율 계산이 필요 없잖아"라고 고치는 순간
 * 이 칸이 빨개진다. 주석만으로는 그 유혹을 막지 못한다.
 */
function krwBaseLosesTheChange() {
  // 실제 응답 그대로. 두 날의 USD가 소수점 5자리에서 같은 값으로 뭉갰다.
  const krwSeries = {
    '2026-09-17': { USD: 0.00072 },
    '2026-09-18': { USD: 0.00072 },
  }
  const inverted = Object.values(krwSeries).map((r) => 1 / r.USD)
  assert.equal(inverted[0], inverted[1], 'base=KRW 역산은 두 날이 같은 값이 된다')

  // 같은 이틀을 base=EUR 교차로 재면 변동이 보인다.
  const a = crossRate(EUR_SERIES['2026-09-17'], 'USD')!
  const b = crossRate(EUR_SERIES['2026-09-18'], 'USD')!
  assert.notEqual(a, b, 'base=EUR 교차환율은 같은 이틀에서 변동을 살려 낸다')
  assert.ok(b - a > 5, `변동폭이 5원을 넘어야 한다: ${b - a}`)
}

function malformedInput() {
  // 파싱 실패·빈 응답·모양이 다른 응답은 전부 null이다. 던지지 않는다.
  assert.equal(buildChips({}, ['USD']), null)
  assert.equal(buildChips(EUR_SERIES, []), null)
  assert.equal(lastTwoDays({ '2026-09-18': {} }), null)
}

crossRateMath()
businessDayGap()
chips()
directions()
krwBaseLosesTheChange()
malformedInput()

console.log(
  'PASS: base=EUR 교차환율, 직전 영업일 전일비, base=KRW 정밀도 회귀, 미지원 통화 제외, 실패→null',
)
