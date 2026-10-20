'use client'

import { useRouter } from 'next/navigation'

/** 회사 · 달 고르기 — 값마다 서버가 만든 주소로 간다(클라이언트가 URL 규칙을 갖지 않는다). 시안의 «DY (주) ▾» 모양. */
export function NavSelect({ label, value, options }: { label: string; value: string; options: { value: string; label: string; href: string }[] }) {
  const router = useRouter()
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const o = options.find((x) => x.value === e.target.value)
        if (o) router.push(o.href)
      }}
      className="min-h-11 lg:min-h-9 rounded-lg border border-[#d7ddda] bg-white px-3 py-1.5 text-[14px] text-[#1a211e] outline-none focus:border-[#0f6b5c]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
