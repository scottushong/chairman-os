import 'server-only'

import { ExtractError, extractAttachment } from '@/lib/attachments/extract'
import { detectMixRatio, type MixVerdict } from '@/lib/intake/mix-ratio'

import { csvToTabbed, isImageDoc, PURCHASE_DOC_MIME } from './doc-rules'

/**
 * 구매 첨부의 배합비 검사 — 저장 **전에**, 서버에서, AI 없이(설계서 8). 글은 메모리에서만 읽고 버린다.
 *
 *   글자층 있음(PDF · Excel · Word · CSV)  → detectMixRatio. 걸리면 저장하지 않는다.
 *   글자층 없음(사진 · 스캔 PDF)           → 검사를 못 탄다 — 올린 사람의 «배합비 · 레시피가 아닙니다» 확인(mix_attested)이 1차 문.
 *   못 읽음(손상 · 암호)                  → 받지 않는다.
 */

export type ScreenResult =
  | { kind: 'clean'; mix_checked: true }
  | { kind: 'no_text' }
  | { kind: 'mix'; verdict: MixVerdict }
  | { kind: 'unreadable'; message: string }

export async function screenPurchaseDoc(bytes: ArrayBuffer, mime: string): Promise<ScreenResult> {
  if (isImageDoc(mime)) return { kind: 'no_text' }

  let units: string[]
  if (mime === PURCHASE_DOC_MIME.csv) {
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
    if (text.trim().length < 5) return { kind: 'unreadable', message: '빈 CSV입니다.' }
    units = [csvToTabbed(text)]
  } else {
    try {
      const ex = await extractAttachment(bytes, mime)
      if (ex.kind !== 'text') return { kind: 'no_text' }
      units = ex.units
    } catch (e) {
      if (e instanceof ExtractError) {
        // 글자층 없는 PDF(스캔) — extract.ts가 «글자를 찾지 못했습니다»로 던진다. 사진과 같은 길(확인 필수)로 보낸다.
        if (/글자를 찾지 못했습니다/.test(e.message)) return { kind: 'no_text' }
        return { kind: 'unreadable', message: e.message }
      }
      return { kind: 'unreadable', message: '파일에서 글을 읽지 못했습니다(손상되었거나 암호가 걸린 파일).' }
    }
  }

  const verdict = detectMixRatio(units)
  return verdict.hit ? { kind: 'mix', verdict } : { kind: 'clean', mix_checked: true }
}

/** 배합비로 보일 때의 문구(mix-ratio.ts MIX_RATIO_MESSAGE의 구매판). 보는 사람 호칭은 부르는 쪽이 boss(role)로 넣는다. */
export function mixRejectMessage(bossWord: string): string {
  return `이 파일은 배합비로 보입니다 — 저장하지 않았습니다. 배합비는 ${bossWord}만 다룹니다.`
}
