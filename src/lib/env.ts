/**
 * 데이터 출처 모드.
 * src/data 의 시드는 06_Dummy_Data 를 확장한 값이라 실적으로 오인되면 안 된다.
 * dummy 인 동안에는 화면 어디에서든 DUMMY DATA 표식이 보이게 하고,
 * Phase 2 에서 실데이터가 붙어 live 가 되면 표식이 통째로 사라진다.
 */
export type DataMode = 'dummy' | 'live'

/** 값이 없으면 dummy 로 본다. 실데이터라고 잘못 말하는 쪽이 훨씬 위험하다. */
export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'dummy'

export const isDummyData = DATA_MODE === 'dummy'
