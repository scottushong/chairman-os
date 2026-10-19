/**
 * 기억 엔진 — Phase 2 이후를 위한 어댑터 자리(지시문 11절). **구현 안 됨** — 업체 · 키는 대표 결정 뒤.
 *
 *   SpeechToText  음성 파일 → 조각(발언자 표시는 «Speaker 1»처럼만 — 사람과 잇는 것은 검토함). 지금은 업체가 없어 음성은
 *                 «원본 보관 · 전사 대기»(memory_capture_assets.processing_status = 'waiting_transcript')로 남는다.
 *   Embedding     글 → 벡터. 표 memory_embeddings(real[] · 같은 판정)만 있다. pgvector를 켜는 새 마이그레이션 + 이 어댑터가 붙으면
 *                 memory_search가 전문 검색 + 벡터를 섞는다(하이브리드). 벡터 결과에도 같은 주인 판정이 걸린다.
 *   ExternalSource Google Calendar · Gmail · Meet · Zoom · 카카오톡/WhatsApp 내보내기(Phase 3) — 같은 memory_capture_save로 들어온다.
 */

export interface TranscriptSegment {
  speaker: string // 'Speaker 1' …
  text: string
  startMs: number | null
  endMs: number | null
}

export interface SpeechToTextAdapter {
  name: string
  transcribe(audio: Uint8Array, mime: string, opts: { language?: 'ko' | 'en' }): Promise<TranscriptSegment[]>
}

export interface EmbeddingAdapter {
  name: string
  model: string
  dims: number
  embed(texts: string[]): Promise<number[][]>
}

export interface ExternalSourceAdapter {
  name: 'google_calendar' | 'gmail' | 'google_meet' | 'zoom' | 'kakao_export' | 'whatsapp_export'
  /** 바깥 자료 하나 → 기록 저장 입력(memory_capture_save). */
  toCapture(raw: unknown): { type: 'meeting' | 'online_meeting' | 'email' | 'conversation'; title: string | null; text: string; capturedAt: string; reference: string }
}

/** 지금 붙은 STT — 없음(업체 결정 전). */
export function currentSpeechToText(): SpeechToTextAdapter | null {
  return null
}

/** 지금 붙은 임베딩 — 없음(업체 결정 전). */
export function currentEmbedding(): EmbeddingAdapter | null {
  return null
}

/**
 * 카카오톡 «대화 내보내기» 글(.txt)을 기록 본문으로 — Phase 3의 첫 조각(파일을 올리면 대화 종류로 저장).
 * 줄 모양 «2026. 10. 19. 오후 3:12, 방 사장 : 내용» · «[방 사장] [오후 3:12] 내용»을 «방 사장: 내용»으로 펴기만 한다.
 */
export function flattenKakaoExport(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const a = /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)?\s*\d{1,2}:\d{2},\s*(.+?)\s*:\s*(.*)$/.exec(line)
      if (a) return `${a[1]}: ${a[2]}`
      const b = /^\[(.+?)\]\s*\[(?:오전|오후)?\s*\d{1,2}:\d{2}\]\s*(.*)$/.exec(line)
      if (b) return `${b[1]}: ${b[2]}`
      return line
    })
    .join('\n')
}
