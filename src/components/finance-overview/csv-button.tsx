'use client'

/** «엑셀로 받기» — 화면에 그린 표를 그대로 CSV(엑셀에서 열림 · BOM 포함)로. 새 경로를 만들지 않는다. */
export function CsvButton({ rows, fileName }: { rows: (string | number)[][]; fileName: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const esc = (v: string | number) => {
          const t = String(v)
          return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
        }
        const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = fileName
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }}
      className="rounded-lg border border-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent hover:bg-accent-soft"
    >
      엑셀로 받기
    </button>
  )
}
