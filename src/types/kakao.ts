import type { IsoDateTime } from './primitives'

/**
 * Phase 3-C 카톡 아침 알림 (0023_chairman_kakao_token).
 *
 * 토큰 값 자체를 담는 타입은 여기 두지 않는다. 화면 코드가 import 할 수 있는 자리에
 * access_token 칸이 있는 타입을 두면, 언젠가 누가 그 타입을 props로 넘긴다.
 * 토큰 한 벌의 모양은 서버 전용 모듈(src/lib/kakao/token.ts)에만 산다.
 */

/** 0023 kakao_token_status()가 내주는 전부. 화면이 "연결됨 / 다시 연결"을 이 값으로만 고른다. */
export interface KakaoConnection {
  connected: true
  /** 카카오가 실제로 준 동의항목(공백 구분). talk_message가 없으면 발송이 -402로 거절된다. */
  scopes: string
  expires_at: IsoDateTime
  refresh_expires_at: IsoDateTime
  updated_at: IsoDateTime
}
