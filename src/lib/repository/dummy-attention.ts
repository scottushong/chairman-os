/**
 * dummy 모드의 주의(ATTENTION) 시드 — Phase 7 블록 B-3.
 *
 * **왜 있는가.** 이 저장소의 확인은 `NEXT_PUBLIC_DATA_MODE=dummy`로만 한다(0035는 아직
 * 어디에도 적용되지 않았고 `npm run db:local`이 이 머신에서 돌지 않는다). 시드가 없으면
 * 화면 셋이 전부 «자료 없음»이고, 그러면 이 블록이 막으려는 거짓 셋이 **화면에서 한 번도
 * 그려지지 않는다** — 배선은 됐는데 한 번도 안 켜지는 코드가 된다.
 *
 * **live(DB)에는 예외를 한 행도 넣지 않는다.** 0035가 0건으로 둔 이유가 그대로 유효하다 —
 * 시드로 넣으면 화면이 첫날부터 있지도 않은 위험을 빨갛게 그리고, 회장이 그 빨강을 한 번
 * 열어 아무것도 없는 것을 확인하면 그 뒤로 진짜 빨강도 안 열어 본다. 여기 있는 것은
 * **개발용 시드**이고, 화면 좌하단의 DATA MODE 뱃지가 매 화면에서 그 사실을 말한다.
 *
 * ■ 이 시드가 일부러 만드는 다섯 가지 «화면에서 눈으로 볼 것» ■
 *   ① **`level`이 null인 예외** — 오늘 출처가 있는 축은 하나뿐이라(`financial_impact`)
 *      `MIN_AXES_FOR_LEVEL = 3`에 닿지 못한다. 그것이 **오늘의 보통**이고, 화면은 그 자리를
 *      «GREEN»이 아니라 «등급 미산출 — 여섯 축 중 5개 없음»으로 적어야 한다.
 *   ② **축 셋으로 등급이 난 예외 하나** — 블록 C·D가 온 뒤의 모양을 미리 세워 둔다.
 *      점수 옆에 `unknown_axes`(3)가 **반드시** 같이 적혀야 한다(45의 근거가 100의 근거인
 *      척하지 않는다). 출처 글자를 축마다 채워 둔 것은 0035의 «축과 출처는 같이 있거나
 *      같이 없다» 제약을 dummy에서도 지키기 때문이다.
 *   ③ **GREEN 예외** — §4가 «GREEN 회사는 Chairman Attention에서 숨긴다»고 했으므로
 *      대시보드 카드에 **보이지 않아야** 하고, `/attention` 목록에는 **있어야** 한다.
 *      숨긴 건수는 카드가 따로 한 줄로 적는다(숨긴 것을 «없는 것»으로 그리지 않는다).
 *   ④ **분석이 없는 예외 하나**(`ai_analysis = null`) — 분석이 없어도 감지는 남는다.
 *      그 자리에 «AI 원인 분석이 없습니다»가 떠야 하고, «결정 아님» 라벨은 분석이 **있는**
 *      자리마다 붙는다.
 *   ⑤ **같은 회사·같은 규칙의 지난 예외**(기간이 다르다) — `/attention`의 «이력»이
 *      실제로 한 줄이라도 그려지게 한다. 0035의 unique가 (회사·규칙·기간)이라 이력은
 *      «다른 기간»으로만 생긴다.
 *
 * ■ «재지 못한 회사»는 시드로 만들지 않는다 — dummy에 이미 진짜가 있다 ■
 *   dummy의 `listFinanceKpis()`는 **원장에서** 낸다(`kpisFromLedger`)이고 그 원장에는
 *   `biz_dy`밖에 없다. 즉 나머지 네 회사는 **정말로 수치가 없어** 규칙을 잴 수 없다.
 *   화면은 그 넷을 «정상»에 넣으면 안 되고 «재지 못한 M개사»로 따로 세어야 한다 —
 *   그 함정을 시드로 지어내지 않고 실제 상태로 보는 것이 더 낫다.
 *
 * ■ 회수(revoked) 계정은 여기서 만들지 않는다 ■ `DUMMY_PEOPLE`에 이미 있고(0002 원칙 8),
 *   읽기 판정은 `dummy.ts`의 `canReadExceptions()`가 0035의 정책을 옮겨 적어 한다.
 */
import { MONITOR_DAYS, type AttentionScore, type ExceptionRecord, type ExceptionRule } from '@/types'

const DY = 'biz_dy'
const VANA = 'biz_vana'
const STICKY = 'biz_sticky'

/**
 * 규칙 13종. **0035 3절의 시드와 글자 하나까지 같다** — 이름·순서·임계·창·출발 등급까지.
 * 갈라지면 dummy에서 본 /attention/rules가 staging에서 다른 표가 되고, 그러면 이 화면으로
 * 임계를 고쳐 본 경험이 아무것도 보장하지 않는다.
 *
 * `manual` 열에는 `metric`·`comparator`·`threshold`·`window_days`가 **전부 null**이다 —
 * 0으로 채우면 «임계 0»이라는 없는 규칙이 생기고, 0035의 `kind_shape_check`가 DB에서
 * 그것을 거절한다. 화면은 그 빈 칸을 «수동 플래그 규칙»이라고 적는다.
 */
export const DUMMY_EXCEPTION_RULES: ExceptionRule[] = [
  rule('revenue_variance', '매출 변동', 'metric', 'YELLOW', 1, 'Revenue', 'abs>', 20, 30),
  rule('ebitda_margin_drop', 'EBITDA 마진 하락', 'metric', 'YELLOW', 2, 'EBITDA', '<=', -5, 90),
  rule('cash_runway', '현금 부족 (Runway 6개월 미만)', 'metric', 'RED', 3, 'Cash', '<', 6, 90),
  rule('debt_covenant', '부채 약정', 'manual', 'RED', 4),
  rule('major_customer_loss', '주요 거래처 이탈', 'manual', 'RED', 5),
  rule('production_stop', '생산 중단', 'manual', 'YELLOW', 6),
  rule('quality_issue', '품질 이슈', 'manual', 'GREEN', 7),
  rule('ceo_forecast_miss', 'CEO 예측 미스', 'manual', 'YELLOW', 8),
  rule('turnover_high', '이직률 초과', 'manual', 'GREEN', 9),
  rule('capital_project_delay', '자본 프로젝트 지연', 'manual', 'YELLOW', 10),
  rule('legal_issue', '법적 이슈', 'manual', 'RED', 11),
  rule('fraud_signal', '부정 신호', 'manual', 'RED', 12),
  rule('security_issue', '보안 이슈', 'manual', 'RED', 13),
]

function rule(
  rule_key: string,
  name: string,
  kind: ExceptionRule['kind'],
  severity_base: ExceptionRule['severity_base'],
  sort_order: number,
  metric: ExceptionRule['metric'] = null,
  comparator: ExceptionRule['comparator'] = null,
  threshold: number | null = null,
  window_days: number | null = null,
): ExceptionRule {
  return {
    rule_key,
    name,
    scope: 'company',
    kind,
    metric,
    comparator,
    threshold,
    window_days,
    severity_base,
    enabled: true,
    sort_order,
  }
}

/**
 * 감지 시각의 기준. **고정 날짜가 아니라 «지금에서 뒤로»다** — 고정하면 시드가 몇 달 뒤에
 * «반년 전에 감지된 주의»가 되어 회장이 화면을 안 믿게 된다. `detected_at`은 timestamptz이고
 * 화면은 그것을 KST로 접어 읽는다(`brief.ts`의 `detected_on`).
 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * 예외 여섯. `id`는 1부터 — live에서는 identity가 주는 값이고 dummy에서는 이 숫자가
 * `attention_scores.exception_id`와 짝을 맞춘다.
 *
 * `value`·`threshold`의 단위는 규칙마다 다르다(%·%p·개월 — `RULE_UNIT`). 수동 규칙
 * (`major_customer_loss`)에는 **둘 다 null**이고 `period`도 null이다 — 잰 값이 없다.
 */
export const DUMMY_EXCEPTIONS: ExceptionRecord[] = [
  {
    // ① RED · 등급 미산출(축 하나) · 분석 있음 · 회장 액션 필요
    id: 1,
    business_id: DY,
    rule_key: 'cash_runway',
    detected_at: daysAgo(1),
    period: '2026-08',
    value: 4.2,
    threshold: 6,
    severity: 'RED',
    ai_analysis:
      '원인: 8월 원자재 선결제가 겹쳐 순소진이 평월의 1.6배가 되었다.\nCEO 대응: 9월 선결제를 분납으로 돌리는 협의를 시작했다.\n권고: 관찰 14일',
    ceo_handling: false,
    chairman_action_required: true,
    status: 'open',
    monitor_until: null,
  },
  {
    // ② YELLOW · **축 셋으로 등급이 난 건**(unknown_axes = 3) · 분석 있음
    id: 2,
    business_id: DY,
    rule_key: 'ebitda_margin_drop',
    detected_at: daysAgo(1),
    period: '2026-08',
    value: -6.4,
    threshold: -5,
    severity: 'YELLOW',
    ai_analysis:
      '원인: 직전 분기 대비 마진이 6.4%p 내려갔다. 매출은 늘었고 원가가 더 빨리 늘었다.\nCEO 대응: 단가 재협상 목록을 만들고 있다.\n권고: 관찰 14일',
    ceo_handling: false,
    chairman_action_required: false,
    status: 'open',
    monitor_until: null,
  },
  {
    // ③ YELLOW · **분석이 없다**(모델 호출 실패의 모양) · 다른 회사
    id: 3,
    business_id: VANA,
    rule_key: 'revenue_variance',
    detected_at: daysAgo(2),
    period: '2026-08',
    value: 34.8,
    threshold: 20,
    severity: 'YELLOW',
    ai_analysis: null,
    ceo_handling: false,
    chairman_action_required: false,
    status: 'open',
    monitor_until: null,
  },
  {
    // ④ GREEN · §4가 숨기라고 한 건. /attention 목록에는 있다.
    id: 4,
    business_id: STICKY,
    rule_key: 'quality_issue',
    detected_at: daysAgo(5),
    period: null,
    value: null,
    threshold: null,
    severity: 'GREEN',
    ai_analysis:
      '원인: 8월 출하분에서 포장 불량 신고가 셋 들어왔다.\nCEO 대응: 포장 라인 점검을 지시했다.\n권고: 관찰 14일',
    ceo_handling: true,
    chairman_action_required: false,
    status: 'open',
    monitor_until: null,
  },
  {
    // ⑤ 관찰 중 — `monitor_until`이 **함께** 있다(0035의 check가 묶은 짝).
    id: 5,
    business_id: DY,
    rule_key: 'major_customer_loss',
    detected_at: daysAgo(9),
    period: null,
    value: null,
    threshold: null,
    severity: 'RED',
    ai_analysis:
      '원인: 3위 거래처가 내년 물량을 30% 줄이겠다고 통보했다.\nCEO 대응: 대체 거래처 둘과 접촉 중이다.\n권고: 관찰 14일',
    ceo_handling: true,
    chairman_action_required: false,
    status: 'monitoring',
    monitor_until: inDays(MONITOR_DAYS - 9),
  },
  {
    // ⑥ 종료 — **같은 회사·같은 규칙의 지난 기간**이다. /attention의 «이력»이 이 줄로 선다.
    id: 6,
    business_id: DY,
    rule_key: 'cash_runway',
    detected_at: daysAgo(40),
    period: '2026-07',
    value: 5.1,
    threshold: 6,
    severity: 'RED',
    ai_analysis:
      '원인: 7월 법인세 납부가 한 달에 겹쳤다.\nCEO 대응: 납부를 분할로 돌렸다.\n권고: 관찰 14일',
    ceo_handling: false,
    chairman_action_required: false,
    status: 'closed',
    monitor_until: null,
  },
]

/**
 * 점수. **예외 하나에 한 줄이고 «없을 수 있다»**(계약 주석) — 그래서 여섯 건 가운데
 * 다섯 건에만 점수를 둔다. 점수 줄이 아예 없는 예외(id 4)에서 화면은 «점수 기록 없음»이라고
 * 적어야 하고, 그것도 «GREEN»이 아니다.
 *
 * `unknown_axes`는 **실제 null 개수와 같다** — 0035의 check가 DB에서 그것을 묶으므로
 * dummy가 그것을 어기면 dummy에서만 서는 화면이 된다.
 */
export const DUMMY_ATTENTION_SCORES: AttentionScore[] = [
  {
    /**
     * 축 하나 → 점수도 등급도 null. **오늘의 보통이다.**
     * 축 값 4는 `financialImpactAxis()`가 이 입력에서 실제로 내는 값이다:
     * `<`라 (6 − 4.2) / 6 = 0.3 → 1 + 0.3×9 = 3.7 → 4. **시드가 엔진과 어긋나지 않게**
     * 손으로 고른 숫자를 두지 않았다 — 어긋나면 dummy에서 본 근거가 live에서 달라진다.
     */
    ...emptyAxes(1, DY),
    financial_impact: 4,
    financial_impact_source:
      '규칙 cash_runway(현금 부족 (Runway 6개월 미만)) — 잰 값 4.2가 임계 6를 넘어선 정도(0035 5절 눈금 0~10)',
    score: null,
    level: null,
    unknown_axes: 5,
  },
  {
    /**
     * 축 셋 → 등급이 난다. **가중치 합은 100 중 45**이고 그 사실이 `unknown_axes = 3`이다.
     * 재무 4는 위와 같은 이유로 엔진이 내는 값이다(`<=`라 (−5 − (−6.4)) / 5 = 0.28 → 4).
     * 나머지 둘은 블록 C·D가 올 자리의 **개발용** 값이고 출처 글자가 그것을 말한다.
     *   (25×4 + 10×(10−2) + 10×1) / 45 × 10 = 42.2 → YELLOW.
     * `ceo_ability`가 **역방향**이라 2는 «CEO가 혼자 풀기 어렵다»이고 점수를 올린다.
     */
    ...emptyAxes(2, DY),
    financial_impact: 4,
    financial_impact_source:
      '규칙 ebitda_margin_drop(EBITDA 마진 하락) — 잰 값 -6.4가 임계 -5를 넘어선 정도(0035 5절 눈금 0~10)',
    ceo_ability: 2,
    ceo_ability_source: '블록 D ceo_scores가 채울 자리 — dummy 개발용 값이다(측정값이 아니다)',
    capital_requirement: 1,
    capital_requirement_source: '블록 C capital_requests가 채울 자리 — dummy 개발용 값이다(측정값이 아니다)',
    score: 42.2,
    level: 'YELLOW',
    unknown_axes: 3,
  },
  {
    // 축 하나. `abs>`라 (34.8 − 20) / 20 = 0.74 → 1 + 6.66 = 8.
    ...emptyAxes(3, VANA),
    financial_impact: 8,
    financial_impact_source:
      '규칙 revenue_variance(매출 변동) — 잰 값 34.8가 임계 20를 넘어선 정도(0035 5절 눈금 0~10)',
    score: null,
    level: null,
    unknown_axes: 5,
  },
  {
    // 수동 규칙이라 잰 값이 없다 → 재무 축도 **없다**(0으로 채우지 않는다). 축 여섯이 전부 빈다.
    ...emptyAxes(5, DY),
    score: null,
    level: null,
    unknown_axes: 6,
  },
  {
    // 지난 기간의 건. (6 − 5.1) / 6 = 0.15 → 1 + 1.35 = 2.
    ...emptyAxes(6, DY),
    financial_impact: 2,
    financial_impact_source:
      '규칙 cash_runway(현금 부족 (Runway 6개월 미만)) — 잰 값 5.1가 임계 6를 넘어선 정도(0035 5절 눈금 0~10)',
    score: null,
    level: null,
    unknown_axes: 5,
  },
]

/** 축 여섯이 전부 빈 한 줄. 채우는 축만 위에서 덮는다 — 빈 축은 **null이고 0이 아니다.** */
function emptyAxes(exception_id: number, business_id: string): AttentionScore {
  return {
    exception_id,
    business_id,
    financial_impact: null,
    financial_impact_source: null,
    strategic_impact: null,
    strategic_impact_source: null,
    urgency: null,
    urgency_source: null,
    probability: null,
    probability_source: null,
    ceo_ability: null,
    ceo_ability_source: null,
    capital_requirement: null,
    capital_requirement_source: null,
    score: null,
    level: null,
    unknown_axes: 6,
    scored_at: daysAgo(1),
  }
}
