'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { revertUpload } from '@/app/actions/finance-upload'

/**
 * 0091 체크표 «빼기» — 그 칸을 채운 파일 하나를 무효로(0070 되돌리기 그대로 — 넣은 지 7일 안 · 마감 달은 대표 · CFO). 빼면 바로 다시 계산.
 * 다시 넣으려면 같은 파일을 다시 올린다.
 */
export function ChecklistWithdraw({ uploadId, businessId, fileName }: { uploadId: string; businessId: string; fileName: string | null }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={fileName ? `${fileName} 빼기` : '이 파일 빼기'}
        onClick={() =>
          start(async () => {
            const r = await revertUpload(uploadId, businessId, '체크표에서 빼기(0091)')
            setMsg(r.error ?? null)
            if (r.ok) router.refresh()
          })
        }
        className="ml-1 inline-flex min-h-11 items-center text-[14px] lg:text-[12px] text-[#6b7772] underline-offset-2 hover:text-[#b4432b] hover:underline disabled:opacity-50 lg:min-h-0"
      >
        {busy ? '빼는 중…' : '빼기'}
      </button>
      {msg ? (
        <span role="status" className="block text-[14px] lg:text-[12px] text-[#b4432b]">
          {msg}
        </span>
      ) : null}
    </>
  )
}
