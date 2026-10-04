'use client'

import { UNIT_LABEL_KO } from '@/lib/ecount/excel/cells'
import { pickKey, type AmountsPreview } from '@/lib/ecount/excel/statement-lines'

/**
 * ② 연간 · ③ 월별 미리보기. 줄마다 맞춘 계정 · 금액(원 단위로 바꾼 값), 파일 합계와 계산의 대조, 차단 · 경고.
 * 연간: 이름이 계정 둘 이상과 맞은 줄은 «맞춘 계정» 칸이 고르기다(onPick — 서버가 다시 미리보기한다). 막힌 줄이
 *   하나도 없으면 등록(onCommit — 0051 RPC). 월별: 막힌 것이 없으면 등록(onCommit — 0052 RPC · 달마다 요약 전표).
 */

const won = (v: number | null) => (v === null ? '' : v.toLocaleString('ko-KR'))

function keyLabel(k: string): string {
  return k === 'amount' ? '당기' : `${Number(k.slice(1))}월`
}

export function EcountAmountsPreview({
  preview,
  picks = {},
  busy = false,
  onPick,
  onCommit,
}: {
  preview: AmountsPreview
  /** 연간 — 줄 열쇠(pickKey) → 고른 계정코드 */
  picks?: Record<string, string>
  busy?: boolean
  onPick?: (key: string, code: string) => void
  onCommit?: () => void
}) {
  const p = preview
  const unpicked = p.lines.filter((l) => l.candidates && l.how !== 'pick').length
  const lineBlocks = p.lines.filter((l) => l.blocks.length).length
  const failedChecks = p.checks.filter((c) => c.diff !== 0)
  return (
    <div className="space-y-3" aria-label="금액 미리보기">
      <div className="flex flex-wrap items-center gap-1.5 text-t11h">
        <span className="rounded bg-raised px-1.5 py-0.5 text-ink-dim">{p.year ?? '해 미정'}년</span>
        <span className="rounded bg-raised px-1.5 py-0.5 text-ink-dim">파일 단위 {UNIT_LABEL_KO[p.unit]} → 원으로 바꿈</span>
        {p.kind === 'monthly' ? (
          <span className={`rounded px-1.5 py-0.5 ${p.converted ? 'bg-accent/15 text-ink' : 'bg-raised text-ink-dim'}`}>
            {p.converted ? '누계 → 당월로 바꿈(앞 달 누계를 뺌 · 1월은 그대로)' : '당월 금액 그대로'}
          </span>
        ) : null}
        <span className="rounded bg-raised px-1.5 py-0.5 text-ink-dim">실을 줄 {p.lines.length}</span>
        <span className={`rounded px-1.5 py-0.5 ${p.blockCount ? 'bg-critical/15 text-critical' : 'bg-raised text-ink-muted'}`}>막힘 {p.blockCount}</span>
        <span className={`rounded px-1.5 py-0.5 ${p.warningCount ? 'bg-warning/15 text-warning' : 'bg-raised text-ink-muted'}`}>경고 {p.warningCount}</span>
      </div>

      {p.blocks.length ? (
        <ul role="alert" className="space-y-0.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {p.blocks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {p.warnings.length ? (
        <ul className="space-y-0.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-t11h text-warning">
          {p.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {p.checks.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-t11">
            <caption className="pb-1 text-left text-t11h font-semibold text-ink-dim">
              파일의 합계 행 대조 — 불일치 {failedChecks.length}건
            </caption>
            <thead>
              <tr className="text-left text-t10h text-ink-muted">
                <th className="px-2 py-1 font-normal">행</th>
                <th className="px-2 py-1 font-normal">항목</th>
                <th className="px-2 py-1 font-normal">열</th>
                <th className="px-2 py-1 text-right font-normal">파일</th>
                <th className="px-2 py-1 text-right font-normal">계산</th>
                <th className="px-2 py-1 text-right font-normal">차액</th>
              </tr>
            </thead>
            <tbody>
              {p.checks.map((c) => (
                <tr key={`${c.sheet}-${c.rowNo}-${c.key}`} className={`border-t border-line-soft ${c.diff ? 'text-critical' : 'text-ink-dim'}`}>
                  <td className="px-2 py-0.5">{c.rowNo}</td>
                  <td className="px-2 py-0.5">{c.label}</td>
                  <td className="px-2 py-0.5">{keyLabel(c.key)}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{won(c.file)}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{won(c.computed)}</td>
                  <td className="px-2 py-0.5 text-right tabular-nums">{c.diff ? won(c.diff) : '맞음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="max-h-[32rem] overflow-auto rounded border border-line-soft">
        <table className="min-w-full text-t11">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-t10h text-ink-muted">
              <th className="px-2 py-1 font-normal">행</th>
              <th className="px-2 py-1 font-normal">과목</th>
              <th className="px-2 py-1 font-normal">맞춘 계정</th>
              {p.keys.map((k) => (
                <th key={k} className="px-2 py-1 text-right font-normal">
                  {keyLabel(k)}
                </th>
              ))}
              <th className="px-2 py-1 font-normal">알림</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={`${l.sheet}-${l.rowNo}`} className="border-t border-line-soft align-top">
                <td className="px-2 py-0.5 text-ink-muted">{l.rowNo}</td>
                <td className="px-2 py-0.5 text-ink">{l.name}</td>
                <td className="px-2 py-0.5 text-ink-dim">
                  {l.candidates && onPick ? (
                    <label className="flex flex-col gap-0.5">
                      <span className="sr-only">{l.rowNo}행 «{l.name}»에 맞출 계정</span>
                      <select
                        value={l.how === 'pick' && l.account ? l.account.code : (picks[pickKey(l)] ?? '')}
                        disabled={busy}
                        onChange={(e) => onPick(pickKey(l), e.target.value)}
                        className={`min-h-11 rounded border bg-panel px-1.5 text-t11 lg:min-h-0 lg:py-0.5 ${l.how === 'pick' ? 'border-line-soft text-ink' : 'border-critical/60 text-critical'}`}
                      >
                        <option value="">계정을 고르세요 ({l.candidates.length}개 후보)</option>
                        {l.candidates.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} · {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : l.account ? (
                    <>
                      <span className="font-mono">{l.account.code}</span> {l.account.name}
                      <span className="text-t10h text-ink-muted"> ({l.how === 'code' ? '코드' : l.how === 'pick' ? '고름' : '이름'})</span>
                    </>
                  ) : (
                    <span className="text-critical">못 맞춤</span>
                  )}
                </td>
                {l.amounts.map((v, i) => (
                  <td key={p.keys[i]} className="px-2 py-0.5 text-right tabular-nums text-ink">
                    {won(v)}
                  </td>
                ))}
                <td className="px-2 py-0.5 text-t10h">
                  {l.blocks.map((b) => (
                    <p key={b} className="text-critical">{b}</p>
                  ))}
                  {l.warnings.map((w) => (
                    <p key={w} className="text-warning">{w}</p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lineBlocks ? (
        <p className="text-t10h text-critical">
          막힌 줄 {lineBlocks}개 — {unpicked ? `계정을 고를 줄 ${unpicked}개 · ` : ''}계정을 먼저 올리거나(계정과목 업로드) 열 지정을 고치세요.
        </p>
      ) : null}

      {p.others.length ? (
        <details className="text-t11 text-ink-dim">
          <summary className="cursor-pointer">싣지 않는 줄(합계 · 소계 · 이익 · 머리) {p.others.length}줄 — 대조에만 씁니다</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {p.others.map((o) => (
              <li key={`${o.sheet}-${o.rowNo}`}>
                {o.rowNo}행 «{o.name}» {o.amounts.some((v) => v !== null) ? `· ${o.amounts.map(won).filter(Boolean).slice(0, 3).join(' / ')}${o.amounts.length > 3 ? ' …' : ''}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {p.kind === 'annual' && onCommit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || p.blockCount > 0}
            onClick={onCommit}
            className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5"
          >
            {p.year ?? ''}년 연간 재무제표 등록(ECOUNT 엑셀 · 잠정)
          </button>
          <span className="text-t10h text-ink-muted">
            {p.blockCount > 0
              ? '막힌 것을 다 푼 뒤에 등록할 수 있습니다.'
              : '서버가 원본을 다시 읽어 같은 판정을 한 번 더 한 뒤 등록합니다. 세무사 확정 결산과는 따로 보관되고, 같은 해를 다시 올리면 새 버전이 됩니다.'}
          </span>
        </div>
      ) : p.kind === 'monthly' && onCommit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || p.blockCount > 0 || p.lines.length === 0}
            onClick={onCommit}
            className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5"
          >
            {p.year ?? ''}년 월별 손익 등록(ECOUNT 엑셀 · 잠정)
          </button>
          <span className="text-t10h text-ink-muted">
            {p.blockCount > 0
              ? '막힌 것을 다 푼 뒤에 등록할 수 있습니다.'
              : '금액이 있는 달마다 요약 전표 한 장(손익 줄 + «ECOUNT 월별손익 대응» 한 줄)으로 장부에 실립니다. 월 마감 전까지 잠정입니다. 같은 달을 다시 올리면 이전 업로드 전표를 정정 전표(역분개 + 새 전표)로 바꿔 두 번 세지 않고, 내용이 같으면 건너뜁니다.'}
          </span>
        </div>
      ) : null}
    </div>
  )
}
