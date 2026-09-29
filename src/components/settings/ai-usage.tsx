import { sumOf } from '@/lib/ai/assistant/calc'
import type { AiUsageDay } from '@/types'

/**
 * /settings «AI 사용량» (Phase 11 · 회장 전용). 0045 ai_usage_log를 날짜(KST) × 기능으로 묶은 표.
 *
 * **비용은 추정이다**(lib/ai/pricing.ts — 공개 단가 × 토큰). 청구서가 아니다 — 화면이 그 말을 적는다.
 * 합계는 코드가 더한다(calc.ts sumOf). 행이 없으면 «0달러»가 아니라 «기록 없음»이라고 말한다.
 */

const FEATURE_KO: Record<string, string> = {
  assistant: 'AI 어시스턴트',
  assistant_kakao: 'AI 어시스턴트(카카오)',
  attachment_summary: '첨부 요약',
  memo_structure: '메모 정리',
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

export function AiUsagePanel({ rows, days }: { rows: AiUsageDay[]; days: number }) {
  if (rows.length === 0) {
    return <p className="text-t11 text-ink-muted">최근 {days}일 동안 기록된 AI 호출이 없습니다(0045 표가 없는 DB도 여기서는 비어 보입니다).</p>
  }
  const byDay = new Map<string, AiUsageDay[]>()
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r])
  const total = sumOf(rows.map((r) => r.cost_usd))
  const calls = rows.reduce((a, r) => a + r.calls, 0)

  return (
    <div>
      <p className="text-t11 text-ink-dim">
        최근 {days}일 · 호출 {calls.toLocaleString('ko-KR')}번 · 추정 비용 <b className="font-semibold text-ink">{usd(total)}</b>
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-t11h">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 pr-2 font-normal">날짜(KST)</th>
              <th className="py-1 pr-2 font-normal">기능</th>
              <th className="py-1 pr-2 text-right font-normal">호출</th>
              <th className="py-1 pr-2 text-right font-normal">토큰(입력/출력)</th>
              <th className="py-1 text-right font-normal">추정 비용</th>
            </tr>
          </thead>
          <tbody>
            {[...byDay.entries()].map(([day, list]) =>
              list.map((r, i) => (
                <tr key={`${day}-${r.feature}`} className="border-t border-line-soft">
                  <td className="py-1 pr-2 text-ink-dim">{i === 0 ? day : ''}</td>
                  <td className="py-1 pr-2">{FEATURE_KO[r.feature] ?? r.feature}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{r.calls}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.input_tokens.toLocaleString('ko-KR')} / {r.output_tokens.toLocaleString('ko-KR')}
                  </td>
                  <td className="py-1 text-right tabular-nums">{usd(r.cost_usd)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-t10h text-ink-muted">
        비용은 공개 단가 × 토큰으로 낸 <b className="font-semibold">추정</b>입니다(청구서가 아닙니다). 대화 하나의 토큰 상한은 서버 설정
        AI_ASSISTANT_CHAT_TOKEN_LIMIT(기본 200,000)입니다.
      </p>
    </div>
  )
}
