'use client'

import { UNIT_LABEL_KO } from '@/lib/ecount/excel/cells'
import type { AmountsPreview } from '@/lib/ecount/excel/statement-lines'

/**
 * ② 연간 · ③ 월별 미리보기 — **검증만**. 줄마다 맞춘 계정 · 금액(원 단위로 바꾼 값), 파일 합계와 계산의 대조,
 * 차단 · 경고. 등록 버튼은 잠겨 있다 — DB 등록 함수(0051 이후)가 생긴 뒤에 연다.
 */

const won = (v: number | null) => (v === null ? '' : v.toLocaleString('ko-KR'))

function keyLabel(k: string): string {
  return k === 'amount' ? '당기' : `${Number(k.slice(1))}월`
}

export function EcountAmountsPreview({ preview }: { preview: AmountsPreview }) {
  const p = preview
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
                  {l.account ? (
                    <>
                      <span className="font-mono">{l.account.code}</span> {l.account.name}
                      <span className="text-t10h text-ink-muted"> ({l.how === 'code' ? '코드' : '이름'})</span>
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
      {lineBlocks ? <p className="text-t10h text-critical">막힌 줄 {lineBlocks}개 — 계정을 먼저 올리거나(계정과목 업로드) 열 지정을 고치세요.</p> : null}

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

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink opacity-40 lg:min-h-0 lg:py-1.5">
          등록은 다음 단계(DB 반영 후)에 열립니다
        </button>
        <span className="text-t10h text-ink-muted">지금은 검증까지입니다. 원본과 열 지정은 남아 있어 다음 단계에서 그대로 등록합니다.</span>
      </div>
    </div>
  )
}
