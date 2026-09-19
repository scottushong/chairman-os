/**
 * 회장 체크인(0019 chairman_checkins)의 입력 한계 — 화면과 서버가 같이 보는 자리.
 *
 * initiative.ts의 GOAL_MAX와 같은 이유로 여기 있다. 상한을 actions/checkin.ts 안에만 두면
 * 그 파일은 'use server'라 상수를 클라이언트가 가져올 수 없고, 그러면 checkin-panel.tsx가
 * 같은 숫자를 다시 적게 된다 — 한쪽만 고치는 날 "화면은 받아 줬는데 서버가 거절하는" 조합이
 * 생긴다. 파일 하나에 상수 하나뿐이지만, 그 하나가 두 쪽을 묶는다.
 */

/** 식사 메모는 한 줄 기록이다. 길어지면 그건 메모가 아니라 일지고, 브리핑 입력으로도 과하다. */
export const MEAL_MAX = 500
