/**
 * 첨부를 AI에 보낼 때의 한도 · 판정 — 순수 함수만(화면 · 서버 · 검사 스크립트가 같은 값을 본다).
 *
 * 한도의 출처는 Anthropic 공식 문서(2026-10-06 확인 — platform.claude.com/docs vision · pdf-support):
 *   이미지  한 장 10MB(base64 기준, Claude API 직접) · Amazon Bedrock · Google Cloud는 5MB(base64).
 *           한 장 8000×8000px. 형식 JPEG · PNG · GIF · WebP.
 *   PDF     요청 하나 32MB · 600쪽(컨텍스트 1M 미만 모델은 100쪽). 암호 걸린 PDF는 안 된다.
 *           쪽마다 그림으로도 읽는다 — 글만 읽을 때보다 토큰이 많다(쪽당 글 1.5~3천 + 그림 토큰).
 *
 * 우리 값.
 *   * 이미지는 **base64 5MB 안**으로 줄여 올린다 — 직접 API(10MB)의 절반이고 Bedrock · Google Cloud 한도와 같다.
 *     플랫폼을 바꿔도 깨지지 않고, 업로드 · 요약이 빠르다. 서버는 직접 API 한도(10MB)를 넘는 것만 거절한다
 *     (이 변경 전에 올라간 4.5MB 이하 사진이 그대로 다시 요약되게).
 *   * 스캔 PDF(글자층이 거의 없는 PDF)는 PDF 그대로 document 블록으로 보낸다. **30쪽까지** — 비용 천장이다
 *     (기본 모델 claude-sonnet-4-5 기준 30쪽 ≈ 5~9만 토큰 ≈ 0.2~0.3달러). API의 쪽 한도(이 모델 100쪽)보다 훨씬 아래다.
 *     앞 N쪽만 잘라 보내려면 PDF를 다시 쓰는 라이브러리가 필요하다(지금 없음) — 넘으면 이유를 밝히고 멈춘다.
 */

const MB = 1024 * 1024

/** base64로 바꾼 길이(바이트). 패딩 포함 — 4 × ⌈n/3⌉. */
export const base64Length = (rawBytes: number) => 4 * Math.ceil(rawBytes / 3)

/** base64 길이가 이 값을 넘지 않는 가장 큰 원본 크기. */
export const maxRawForBase64 = (base64Bytes: number) => Math.floor(base64Bytes / 4) * 3

/** Claude API(직접) 이미지 한 장 한도 — base64 10MB. 서버의 마지막 문. */
export const API_IMAGE_MAX_BASE64 = 10 * MB
/** 우리가 맞추는 이미지 크기 — base64 5MB(Bedrock · Google Cloud 한도와 같다). */
export const IMAGE_TARGET_BASE64 = 5 * MB
/** 이 크기를 넘는 사진은 브라우저가 줄여 올린다. = 3.75MB(base64로 정확히 5MB). 예전 값 4.5MB는 base64로 6MB였다. */
export const IMAGE_SOFT_MAX_BYTES = maxRawForBase64(IMAGE_TARGET_BASE64)
/** API의 한 장 가로 · 세로 한도. */
export const IMAGE_MAX_EDGE_PX = 8000

/** 브라우저가 줄여 올려야 하는가 — 크기(base64 5MB 초과) 또는 가로 · 세로(8000px 초과). */
export function imageNeedsShrink(bytes: number, width?: number, height?: number): boolean {
  if (base64Length(bytes) > IMAGE_TARGET_BASE64) return true
  return Math.max(width ?? 0, height ?? 0) > IMAGE_MAX_EDGE_PX
}

/** 요청 하나 32MB에서 프롬프트 · JSON 몫을 뺀 PDF base64 천장. */
export const PDF_DOC_MAX_BASE64 = 30 * MB
/** 스캔 PDF를 통째로 보내는 쪽 수 천장(비용). */
export const PDF_DOC_MAX_PAGES = 30
/** 쪽당 평균 글자가 이보다 적으면 «글자층이 거의 없다» = 스캔본으로 본다. 쪽 번호 · 도장 글자 정도는 남는다. */
export const SCANNED_CHARS_PER_PAGE = 40

export type PdfRoute =
  | { route: 'text' }
  | { route: 'document' }
  | { route: 'reject'; reason: string }

/**
 * PDF를 어느 길로 읽을지. pages = 전체 쪽 수, chars = 글자층에서 읽은 글자 합, bytes = 파일 크기.
 *   글자층이 있다 → text(기존 길 — 싸다).
 *   거의 없다     → document(PDF 그대로 Claude에) — 쪽 · 크기 천장 안에서만.
 */
export function pdfRoute(pages: number, chars: number, bytes: number): PdfRoute {
  const perPage = pages > 0 ? chars / pages : chars
  if (chars >= 20 && perPage >= SCANNED_CHARS_PER_PAGE) return { route: 'text' }
  if (pages < 1) return { route: 'reject', reason: '쪽이 없는 PDF입니다' }
  if (pages > PDF_DOC_MAX_PAGES) {
    return {
      route: 'reject',
      reason: `스캔한 PDF가 ${pages}쪽입니다(스캔본은 한 번에 ${PDF_DOC_MAX_PAGES}쪽까지 읽습니다). ${PDF_DOC_MAX_PAGES}쪽 이하로 나눠 올리면 읽습니다`,
    }
  }
  if (base64Length(bytes) > PDF_DOC_MAX_BASE64) {
    return { route: 'reject', reason: `스캔한 PDF가 너무 큽니다(${(bytes / MB).toFixed(1)}MB). 해상도를 낮추거나 나눠 올리면 읽습니다` }
  }
  return { route: 'document' }
}

/** 서버 이미지 문 — 직접 API 한도를 넘으면 이유 문장, 아니면 null. */
export function imageRejectReason(bytes: number): string | null {
  if (base64Length(bytes) <= API_IMAGE_MAX_BASE64) return null
  return `사진이 너무 큽니다(${(bytes / MB).toFixed(1)}MB). 지우고 다시 올리면 자동으로 줄여 올립니다`
}

/** «읽지 못함» 문장 하나 — 화면 · 저장(ai_error)이 같은 모양을 쓴다. 끝 마침표는 한 번만. */
export function unreadableMessage(reason: string): string {
  const r = reason.trim().replace(/[.。]+$/, '')
  return `이 파일은 아직 읽을 수 없습니다 — ${r}. 파일은 올라갔습니다.`
}

/**
 * 받지 않는 형식이지만 브라우저가 JPEG로 바꿔 올릴 수 있는 사진(HEIC · HEIF · WebP · GIF).
 * DB(0045 attachments_mime_check)는 png · jpeg만 받는다 — 바꾼 JPEG가 «원본»이 된다(DB 변경 없음).
 * HEIC는 Safari(아이폰 · 맥)만 연다. 열지 못하면 이유를 밝히고 올리지 않는다.
 */
export function convertibleImage(fileName: string, browserType: string): 'heic' | 'webp' | 'gif' | null {
  const t = browserType.toLowerCase()
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (t === 'image/heic' || t === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic'
  if (t === 'image/webp' || ext === 'webp') return 'webp'
  if (t === 'image/gif' || ext === 'gif') return 'gif'
  return null
}

/** 바꾸지 못한 사진 — 올리기 전에 멈춘다(파일은 올라가지 않았다). */
export function unconvertibleMessage(fileName: string, kind: 'heic' | 'webp' | 'gif'): string {
  const why =
    kind === 'heic'
      ? 'HEIC 사진을 이 브라우저가 열지 못합니다. 아이폰 설정 › 카메라 › 포맷 › «높은 호환성»으로 찍거나 JPG로 저장해 올리세요'
      : '사진을 열지 못했습니다. JPG · PNG로 저장해 올리세요'
  return `${fileName}: 이 사진은 아직 올릴 수 없습니다 — ${why}. 파일은 올리지 않았습니다.`
}
