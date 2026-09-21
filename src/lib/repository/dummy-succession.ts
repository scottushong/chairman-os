/**
 * dummy 모드의 승계 시드 — Phase 7 블록 A.
 *
 * **왜 있는가.** 이 저장소의 확인은 `NEXT_PUBLIC_DATA_MODE=dummy`로만 한다(0033은 아직
 * 어디에도 적용되지 않았다). 시드가 없으면 /dependency는 다섯 회사 전부 '자료 없음'이고,
 * 그러면 이 블록이 만든 화면 중 절반이 한 번도 그려지지 않는다 — 배선은 됐는데 한 번도
 * 안 켜지는 코드가 된다(블록 7의 dummy-activity.ts가 같은 이유로 생겼다).
 *
 * **여기 있는 숫자는 시드다. 측정값이 아니다.** 화면 좌하단의 DATA MODE 뱃지가 그 사실을
 * 매 화면에서 말한다(live로 바꾸면 이 파일은 한 줄도 안 쓰인다).
 *
 * ■ staging과 같은 것 · 다른 것 ■
 *   같다 — DY의 의존 영역 8줄 · 부재 테스트 2건 · Direction. 0033 11절의 값을 그대로 옮겼다.
 *          (둘이 갈라지면 dummy에서 본 화면이 staging에서 다르게 선다. 검사가 맞춰 본다.)
 *   다르다 — **결정 이력.** 0033은 decisions에 시드를 넣지 않는다(§7 지표를 시드로 만들면
 *           그것은 측정이 아니다). dummy에는 12개월 치 처리된 결정이 있어야 스파크라인과
 *           큰 숫자가 화면에서 실제로 그려진다. 그래서 여기서만 만든다.
 *   다르다 — **자율성 평가.** DY에는 넣지 않았다(문서에 DY의 현재 등급이 없다).
 *           VANA·Sticky에만 넣어 '평가 있음'과 '평가 없음' 두 화면을 **둘 다** 볼 수 있게 했다.
 *
 * ■ 역산이 닿지 않은 행도 시드에 있다 ■ DY의 가장 오래된 두 달에 decided_by_kind가 null인
 * 결정이 섞여 있다. 그 줄이 없으면 '역산 미도달 N건'이라는 화면 문구가 개발 중에 한 번도
 * 안 뜨고, 그러면 그 문구가 실제로 맞는지 아무도 모른 채로 배포된다.
 */
import { recentPeriods, type DecisionForIndex } from '@/lib/dependency'
import type {
  AbsenceTest,
  AutonomyAssessment,
  ChairmanDirection,
  DependencyArea,
  InterventionRow,
} from '@/types'

const DY = 'biz_dy'

/**
 * 의존 영역 8줄. **0033 11절과 같은 값이다.**
 * 의존도 평가 6 + 이양 계획 7, 겹치는 5 → 합집합 8.
 * level·transfer_status의 null은 'LOW'도 'not_started'도 아니다 — 아직 없다는 뜻이다.
 */
export const DUMMY_DEPENDENCY_AREAS: DependencyArea[] = [
  a(1, '가격 결정', 'Pricing', 'HIGH', 'in_progress', '2026-12-31',
    '§7 Pricing 72% · §11 IN PROGRESS. 이양 진행 중인 유일한 HIGH 영역이다.'),
  a(2, '주요 거래처', 'Top Customers', 'HIGH', 'not_started', '2027-06-30',
    '§7 Top Customers 83% · §11 NOT TRANSFERRED. 회장 의존이 가장 높은 자리.'),
  a(3, '베트남 투자', 'Vietnam Strategy', 'HIGH', 'not_started', null,
    '§7 Vietnam Strategy 67% · §11 NOT TRANSFERRED. §20 Priorities 1번이기도 하다.'),
  a(4, 'R&D', 'R&D', 'MEDIUM', null, null,
    '§7 R&D 41%. 이양 상태는 비워 둔다 — §11 TRANSFER MATRIX에 R&D가 없고 §35 화면 예시에는 IN PROGRESS로 있어 문서 안에서 어긋난다.'),
  a(5, '채용', 'Routine Hiring', 'LOW', 'done', null, '§7 Hiring 8% · §11 COMPLETE.'),
  a(6, '생산', 'Production', 'LOW', 'done', null, '§7 Production 12% · §11 COMPLETE.'),
  a(7, '국내 영업', 'Domestic Sales', null, 'done', null,
    '§11 COMPLETE. 의존도 평가는 아직 없다 — §7의 영역 목록에 없다.'),
  a(8, '자본 배분', 'Capital Allocation', null, 'not_started', null,
    '§11 NOT TRANSFERRED. 의존도 평가는 아직 없다. §13 자본 배분은 블록 C가 들고 온다.'),
]

function a(
  id: number,
  area: string,
  area_en: string,
  level: DependencyArea['level'],
  transfer_status: DependencyArea['transfer_status'],
  target_date: string | null,
  note: string,
): DependencyArea {
  return { id, business_id: DY, area, area_en, level, transfer_status, target_date, note, sort_order: id }
}

/** 부재 테스트 — §34 TARGET. 0033 11절과 같은 두 줄. */
export const DUMMY_ABSENCE_TESTS: AbsenceTest[] = [
  {
    id: 1, business_id: DY, days: 30, scheduled_on: '2026-08-03', result: 'pass',
    note: '§34 30-day absence PASS. 8월 첫 주. 부재 중 회장 결재 요청 0건.',
  },
  {
    id: 2, business_id: DY, days: 90, scheduled_on: '2026-12-01', result: 'pending',
    note: '§34 90-day absence. 12월 시작 예정. 결과는 치른 뒤에 적는다.',
  },
]

/**
 * 자율성 평가. **DY에는 없다** — 문서 어디에도 "DY는 지금 L몇"이 없다(§34는 목표가 L5라고만
 * 한다). 없는 자리를 화면이 어떻게 말하는지 개발 중에 보려면 비어 있는 회사가 있어야 한다.
 */
export const DUMMY_AUTONOMY: AutonomyAssessment[] = [
  { id: 1, business_id: 'biz_vana', quarter: '2026-Q3', level: 'L4', assessed_by: null, note: '자본 결정만 회장 승인. 그 밖은 독립.' },
  { id: 2, business_id: 'biz_vana', quarter: '2026-Q2', level: 'L3', assessed_by: null, note: null },
  { id: 3, business_id: 'biz_sticky', quarter: '2026-Q3', level: 'L3', assessed_by: null, note: 'P&L 전담. 임계 미만 투자는 자체 승인.' },
]

/** Direction — §20의 DY 예시 그대로. 0033 11절과 같다. letter·contact_when은 비어 있다. */
export const DUMMY_DIRECTIONS: ChairmanDirection[] = [
  {
    business_id: DY,
    five_year: '글로벌 접착제 네트워크가 된다.',
    priorities: ['베트남', '동남아시아', 'Sticky Alliance', '고마진 특수 접착제'],
    do_not: ['범용 가격 경쟁', '저마진 확장'],
    contact_when: [],
    why_own: null,
    capital_philosophy: null,
    cares_about: [],
    not_managed: [],
    red_lines: [],
    letter: null,
    updated_at: null,
  },
]

/**
 * 12개월 치 처리된 결정. 회사별로 (전체 건수, 회장 비율)을 주고 행으로 편다.
 *
 * DY는 §7 TREND의 모양(41 → 34 → 27로 내려간다)을 따르게 두었다. 그 세 숫자는 문서의
 * 예시이지 이 저장소가 잰 값이 아니다 — dummy에서만 쓰고, live에서는 뷰가 센 값이 나온다.
 */
const SHAPE: Record<string, { total: number; pct: number[] }> = {
  //                     12개월 전 ──────────────────────────────────→ 이번 달
  biz_dy:     { total: 18, pct: [58, 55, 52, 50, 47, 45, 44, 41, 41, 34, 27, 29] },
  biz_vana:   { total: 11, pct: [34, 31, 30, 28, 27, 25, 24, 22, 21, 19, 18, 18] },
  biz_sticky: { total: 9,  pct: [46, 44, 43, 41, 40, 38, 37, 36, 34, 33, 31, 30] },
  biz_hof:    { total: 5,  pct: [80, 80, 75, 75, 70, 70, 66, 66, 60, 60, 55, 55] },
  biz_boram:  { total: 7,  pct: [40, 38, 36, 35, 33, 32, 30, 29, 28, 27, 26, 25] },
}

/**
 * 역산이 닿지 않은 행. **DY의 가장 오래된 두 달에만 있다** — 0033 이전의 기록이라
 * audit_log에 처리 줄이 없는 건들이다. 화면의 '역산 미도달 N건'이 실제로 뜨게 하는 입력이다.
 */
const UNKNOWN_BY_MONTH = [3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

export function dummyDecisionRows(now = new Date()): DecisionForIndex[] {
  const periods = recentPeriods(12, now)
  const rows: DecisionForIndex[] = []

  for (const [business_id, shape] of Object.entries(SHAPE)) {
    periods.forEach((period, i) => {
      const total = shape.total
      const chairman = Math.round((total * shape.pct[i]) / 100)
      // 나머지를 CEO와 규칙으로 나눈다. 규칙은 전체의 1/5쯤 — §7 예시(21/100)의 비율이다.
      const rule = Math.round((total - chairman) / 5)
      const ceo = total - chairman - rule
      push(rows, business_id, period, 'chairman', chairman)
      push(rows, business_id, period, 'ceo', ceo)
      push(rows, business_id, period, 'rule', rule)
      if (business_id === DY) push(rows, business_id, period, null, UNKNOWN_BY_MONTH[i])
    })
  }
  return rows
}

function push(
  rows: DecisionForIndex[],
  business_id: string,
  period: string,
  kind: DecisionForIndex['decided_by_kind'],
  count: number,
) {
  for (let i = 0; i < count; i += 1) {
    // 그 달 15일 정오(KST). 월 경계에서 달이 밀리지 않는 시각이면 무엇이든 된다.
    const decided_at = new Date(`${period}-15T12:00:00+09:00`).toISOString()
    rows.push({ business_id, status: 'Approved', decided_at, created_at: decided_at, decided_by_kind: kind })
  }
}

/**
 * 회장 개입 — 회사 × 월 × 유형.
 *
 * live에서는 audit_log에서 뷰가 센다. **그 뷰는 회장 세션에서만 행이 나온다**(audit_log의
 * FORCE RLS). dummy 어댑터도 같은 게이트를 둔다 — 여기가 다르면 dummy에서 본 화면이 거짓이 된다.
 *
 * 건수는 같은 달의 '회장이 정한 결정' 수에서 나온다. 개입은 그 결정을 만든 행위 자체라
 * 두 숫자가 따로 놀면 화면 안에서 앞뒤가 안 맞는다.
 */
export function dummyInterventions(rows: DecisionForIndex[]): InterventionRow[] {
  const by = new Map<string, number>()
  for (const r of rows) {
    if (r.decided_by_kind !== 'chairman') continue
    const period = (r.decided_at ?? r.created_at).slice(0, 7)
    const key = `${r.business_id} ${period}`
    by.set(key, (by.get(key) ?? 0) + 1)
  }

  const out: InterventionRow[] = []
  for (const [key, n] of by) {
    const [business_id, period] = key.split(' ')
    // 승인이 대부분이고 반려·수정요청·위임이 조금씩이다. 나머지를 버리지 않고 승인에 남긴다.
    const reject = Math.floor(n / 6)
    const modify = Math.floor(n / 8)
    const delegate = Math.floor(n / 10)
    const approve = n - reject - modify - delegate
    if (approve > 0) out.push({ business_id, period, kind: 'approve', count: approve })
    if (reject > 0) out.push({ business_id, period, kind: 'reject', count: reject })
    if (modify > 0) out.push({ business_id, period, kind: 'modify', count: modify })
    if (delegate > 0) out.push({ business_id, period, kind: 'delegate', count: delegate })
  }
  return out.sort((x, y) => x.period.localeCompare(y.period))
}
