import Link from 'next/link'

import {
  AiAnalysis,
  BlindNote,
  CeoHandling,
  Measured,
  ScoreLevel,
  SeverityChip,
} from '@/components/attention/pieces'
import { TriageButtons } from '@/components/attention/triage-buttons'
import { Icon } from '@/components/ui/icon'
import type { AttentionView } from '@/lib/attention/screen'

/**
 * 대시보드 최상단 **CHAIRMAN ATTENTION** 다크 카드 — §4(348~378줄) · §18 · §19.
 *
 * ■ 이 카드가 답하는 질문 ■ "오늘 회장이 **어디를** 볼 것인가." §19가 그 경계를 한 줄로
 * 못 박았다 — *"AI가 CEO를 대신하지 않는다. AI는 Chairman에게 «어디를 볼 것인가»를 알려준다."*
 * 그래서 이 카드는 **판정을 그리지 않고 자리를 가리킨다.**
 *
 * ■ §4가 정한 모양 ■ RED/YELLOW **최대 다섯 건**, GREEN은 숨긴다. 건마다 회사 · 규칙 ·
 * 잰 값 · 원인 한 줄 · CEO 대응 · 등급. 맨 아래 한 줄로 «나머지 N개사».
 *
 * ■ 여기서 아무것도 계산하지 않는다 ■ 고르는 것·세는 것·문장 만드는 것이 전부
 * `lib/attention/screen.ts`의 `summarizeAttention()`이고, 그 함수는 «맨 위 다섯»의 순서를
 * 브리핑과 **같은** `selectAttentions()`로 정한다 — 회장이 06:00 카톡에서 본 순서와
 * 이 카드의 순서가 어긋나면 «맨 위»가 두 뜻을 갖는다.
 *
 * ■ 세 가지 거짓을 이 카드가 막는다 ■
 *   ① 읽기 집합 밖 계정(TeamLead·Member)에게 **«주의 0건»도 «전 회사 정상»도 적지 않는다.**
 *      `view.readable`이 false면 아래 한 줄은 **건수를 하나도 말하지 않고** 권한 문장만 적는다.
 *   ② «정상 N개사»와 **«재지 못한 M개사»를 따로** 적는다. `finance_kpis`가 없어 규칙을 못 잰
 *      회사를 정상에 넣으면, B-2가 `unmeasured`를 별개 칸으로 만들어 브리핑까지 밀어 넣은
 *      작업이 마지막 걸음에서 무의미해진다.
 *   ③ 등급은 `ScoreLevel` 하나로만 나오고 그 조각은 `unknown_axes`를 **반드시** 같이 적는다.
 *      오늘 대부분의 건은 «등급 미산출»이다 — GREEN이 아니다.
 *   ④ `ai_analysis`는 `AiAnalysis` 하나로만 나오고 그 조각의 «결정 아님» 라벨은 **상수다.**
 *
 * ■ 기존 경보 패널·배너를 지우지 않는다 ■ 이 카드는 그 **위**에 선다. Phase 7은 기존 화면을
 * 삭제하지 않고, `alerts`와 `exceptions`를 합치는 것은 블록 E가 HOME을 다시 지을 때의 판단이다
 * (0035 머리 주석이 같은 말을 한다 — 지금 합치면 쓰이는 표와 안 쓰이는 표를 같이 옮기는 일이 된다).
 */
export function AttentionCard({
  view,
  canTriage,
}: {
  view: AttentionView
  /**
   * 회장 액션 버튼을 **그릴지** 정한다. 권한 판정이 아니라 렌더 판정이다 —
   * 판정은 0035의 `exceptions_triage`가 하고, 여기서는 «눌러도 거부당하는 버튼을 두지
   * 않는다»만 지킨다(블록 A의 `AreaEditor`와 같은 모양·같은 이유).
   */
  canTriage: boolean
}) {
  return (
    <section
      aria-label="Chairman Attention"
      data-theme="dark"
      className="mt-4 overflow-hidden rounded-glass border border-line-soft bg-panel p-4"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon name="bell" className="size-4 text-gold" filled />
          CHAIRMAN ATTENTION
        </h2>
        <span className="text-[10.5px] text-ink-muted tnum">
          {view.readable ? `열린 예외 ${view.openCount}건 · RED/YELLOW 최대 5건` : '§18 · §19'}
        </span>
        <Link
          href="/attention"
          className="ml-auto text-[11px] text-ink-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          전체 보기
        </Link>
      </div>

      {!view.readable ? (
        // ① 못 보는 것을 «없는 것»으로 그리지 않는다. 건수를 하나도 적지 않는다.
        <div className="mt-2.5 rounded-lg bg-raised px-3 py-2.5">
          <BlindNote />
        </div>
      ) : view.top.length === 0 ? (
        <p className="mt-2.5 rounded-lg bg-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-dim">
          지금 회장 판단을 기다리는 RED/YELLOW 예외가 없습니다.
          {/* 숨긴 GREEN을 «없는 것»으로 그리지 않는다(§4는 숨기라고 했고, 숨긴 것은 있는 것이다). */}
          {view.hiddenGreen > 0 ? (
            <span className="block text-[10.5px] text-ink-muted">
              GREEN {view.hiddenGreen}건은 §4대로 이 카드에서 숨겼습니다 — CEO가 처리하는 건입니다.
            </span>
          ) : null}
        </p>
      ) : (
        <ul className="mt-2.5 space-y-1.5">
          {view.top.map((row) => (
            <li key={row.exception.id} className="rounded-lg bg-raised px-3 py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <SeverityChip level={row.exception.severity} />
                <span className="text-[12.5px] font-semibold text-ink">{row.business_name}</span>
                <span className="text-[11.5px] text-ink-dim">{row.rule_name}</span>
                <Measured row={row} />
                {row.exception.period ? (
                  <span className="text-[10px] text-ink-muted tnum">기간 {row.exception.period}</span>
                ) : null}
                {/* §19: RED = Chairman decision. 그 칸이 참인 건만 이 말을 붙인다. */}
                {row.exception.chairman_action_required ? (
                  <span className="rounded bg-critical/15 px-1.5 py-0.5 text-[9.5px] font-bold text-critical">
                    회장 결정 필요
                  </span>
                ) : null}
              </div>

              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {/* ③ 등급과 빈 축은 한 조각에서만 나온다. */}
                <ScoreLevel row={row} />
                <CeoHandling handling={row.exception.ceo_handling} />
              </div>

              {/* ④ «결정 아님»이 상수로 붙는 유일한 조각. */}
              <div className="mt-1.5">
                <AiAnalysis analysis={row.exception.ai_analysis} />
              </div>

              {canTriage ? (
                <div className="mt-1.5">
                  <TriageButtons
                    exceptionId={row.exception.id}
                    businessId={row.exception.business_id}
                  />
                </div>
              ) : (
                <p className="mt-1.5 text-[10px] text-ink-muted">
                  이 계정에는 처리 권한이 없습니다 — 회장 · 그 회사의 대표만 처리합니다.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <AttentionFooter view={view} />
    </section>
  )
}

/**
 * §4의 마지막 한 줄 — 원문은 `"47 companies operating normally. No Chairman action required."`다.
 *
 * ■ **그 한 줄을 두 칸으로 적는다** ■ 「정상 N개사」와 「재지 못한 M개사」다. 원문의 한 줄을
 * 그대로 옮기면 `finance_kpis`가 없어 규칙을 못 잰 회사가 **정상에 섞인다.** B-2가
 * `unmeasured`를 `failed`와 별개 칸으로 만들어 06:00 브리핑까지 밀어 넣은 이유가 그것이고,
 * 화면에서 다시 뭉개면 그 작업이 마지막 걸음에서 무의미해진다. 「재지 못했다」는
 * 「이상 없다」가 아니다.
 *
 * ■ 읽기 집합 밖이면 **아무 숫자도 적지 않는다** ■ 그 계정은 `finance_kpis`도 못 읽어서
 * 모든 회사가 «재지 못함»으로 나오고, 그 M은 회사의 사실이 아니라 권한의 그림자다.
 * 그림자를 숫자로 적는 것이 이 카드가 막는 첫 번째 거짓이다.
 *
 * 이 컴포넌트를 따로 둔 이유: `check:attention`이 이 한 줄만 떼어 렌더해 잰다.
 */
export function AttentionFooter({ view }: { view: AttentionView }) {
  if (!view.readable) {
    return (
      <div data-attention-footer className="mt-2.5 border-t border-line-soft pt-2">
        <BlindNote />
      </div>
    )
  }
  return (
    <div
      data-attention-footer
      className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line-soft pt-2 text-[11px] text-ink-dim tnum"
    >
      <span>주의 {view.attentionCompanies.length}개사</span>
      <span>정상 {view.normal.length}개사</span>
      {/* 한 칸에 담지 않는다. 이 둘을 더해 «정상»이라고 적는 것이 §4의 함정이다. */}
      <span className={view.unmeasured.length > 0 ? 'text-warning' : undefined}>
        재지 못한 {view.unmeasured.length}개사
      </span>
      {view.hiddenGreen > 0 ? (
        <span className="text-ink-muted">GREEN {view.hiddenGreen}건 숨김(§4)</span>
      ) : null}
      {view.unmeasured.length > 0 ? (
        <span className="basis-full text-[10px] leading-relaxed text-ink-muted">
          재지 못한 회사는 «이상 없음»이 아닙니다 —{' '}
          {view.unmeasured.map((u) => u.name).join(' · ')}. 이유는{' '}
          <Link href="/attention" className="underline underline-offset-2">
            주의 목록
          </Link>
          에 회사별로 적혀 있습니다.
        </span>
      ) : null}
    </div>
  )
}
