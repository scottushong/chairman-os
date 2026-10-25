import { DEFAULT_WEIGHTS } from './scores'
import type { InvManager, InvSettings, InvSource } from './types'

/**
 * 0094 시드의 TS 거울 — dummy 저장소 · 메모리 싱크 · 검사가 쓴다. check:investment가 SQL 시드와 같은지 대조한다
 * (기관 id · CIK · 유형 · 신호 가중치, 경로 id · 종류 · 키 이름). 한쪽만 고치면 검사가 빨개진다.
 */

export const SEED_MANAGERS: InvManager[] = [
  {
    manager_id: 'nbim',
    name: 'Norway Government Pension Fund Global',
    operator: 'Norges Bank Investment Management (NBIM)',
    official_url: 'https://www.nbim.no/en/investments',
    sec_cik: '0001374170',
    sec_filer_name: 'NORGES BANK',
    style: 'index',
    signal_weight: 0.5,
    coverage_note:
      '전체 보유 목록은 반기 공개(평가액 · 지분율 · 국가 · 업종, 주식 수 없음). 미국 상장분 주식 수는 SEC 13F(분기). 지수 기반 분산 투자 — 집중투자 기관보다 낮은 확신 신호.',
    sort_order: 1,
  },
  {
    manager_id: 'berkshire',
    name: 'Berkshire Hathaway',
    operator: 'Berkshire Hathaway Inc.',
    official_url: 'https://www.berkshirehathaway.com',
    sec_cik: '0001067983',
    sec_filer_name: 'BERKSHIRE HATHAWAY INC',
    style: 'concentrated',
    signal_weight: 1,
    coverage_note:
      'SEC 13F 대상 미국 증권만(분기말 기준 · 통상 분기 종료 후 45일 안 공개). 현금 · 비상장 · 해외 직접 투자 · 공매도 · 일부 파생은 보이지 않는다 — Berkshire 전체 포트폴리오가 아니다.',
    sort_order: 2,
  },
  {
    manager_id: 'fundsmith',
    name: 'Fundsmith',
    operator: 'Fundsmith LLP',
    official_url: 'https://www.fundsmith.co.uk',
    sec_cik: '0001569205',
    sec_filer_name: 'Fundsmith LLP',
    style: 'concentrated',
    signal_weight: 1,
    coverage_note: 'SEC 13F(Fundsmith LLP, 미국 상장분 · 분기)와 공식 월간 Factsheet(상위 보유). 공개하지 않은 포지션은 추정하지 않는다.',
    sort_order: 3,
  },
  {
    manager_id: 'pershing',
    name: 'Pershing Square Holdings',
    operator: 'Pershing Square Capital Management, L.P.',
    official_url: 'https://pershingsquareholdings.com',
    sec_cik: '0001336528',
    sec_filer_name: 'Pershing Square Capital Management, L.P.',
    style: 'concentrated',
    signal_weight: 1,
    coverage_note:
      'SEC 13F는 운용사(Pershing Square Capital Management) 전체의 미국 상장분이다 — PSH 펀드의 전체 포지션과 같지 않다. 공식 사이트 공개 포지션은 따로 적는다.',
    sort_order: 4,
  },
]

const src = (p: Pick<InvSource, 'source_id' | 'manager_id' | 'label' | 'kind' | 'url' | 'cadence' | 'key_env' | 'status' | 'status_note'>): InvSource => ({
  last_attempt_at: null,
  last_success_at: null,
  last_error: null,
  calls_day: null,
  calls_today: 0,
  ...p,
})

export const SEED_SOURCES: InvSource[] = [
  src({ source_id: 'sec13f:nbim', manager_id: 'nbim', label: 'SEC 13F — Norges Bank', kind: 'sec_13f', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001374170&type=13F-HR', cadence: '분기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'sec13f:berkshire', manager_id: 'berkshire', label: 'SEC 13F — Berkshire Hathaway', kind: 'sec_13f', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001067983&type=13F-HR', cadence: '분기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'sec13f:fundsmith', manager_id: 'fundsmith', label: 'SEC 13F — Fundsmith LLP', kind: 'sec_13f', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001569205&type=13F-HR', cadence: '분기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'sec13f:pershing', manager_id: 'pershing', label: 'SEC 13F — Pershing Square Capital Management', kind: 'sec_13f', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001336528&type=13F-HR', cadence: '분기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'nbim:holdings', manager_id: 'nbim', label: 'NBIM 전체 보유 목록', kind: 'nbim_holdings', url: 'https://www.nbim.no/en/investments/all-investments/', cadence: '반기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'fundsmith:factsheet', manager_id: 'fundsmith', label: 'Fundsmith Equity Fund 월간 Factsheet', kind: 'factsheet', url: 'https://www.fundsmith.co.uk', cadence: '월', key_env: null, status: 'UNAVAILABLE', status_note: '공식 사이트가 자동 수집을 막는다(Cloudflare 확인 화면) — 대표 손 입력(출처 · 기준일 필수)' }),
  src({ source_id: 'pershing:site', manager_id: 'pershing', label: 'Pershing Square Holdings 공식 사이트 공개 포지션', kind: 'site', url: 'https://pershingsquareholdings.com', cadence: '수시', key_env: null, status: 'UNAVAILABLE', status_note: '공식 사이트가 자동 수집을 막는다(403) — 대표 손 입력(출처 · 기준일 필수)' }),
  src({ source_id: 'sec:xbrl', manager_id: null, label: 'SEC XBRL companyfacts(기업 재무)', kind: 'sec_xbrl', url: 'https://www.sec.gov/edgar/sec-api-documentation', cadence: '공시', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'openfigi', manager_id: null, label: 'OpenFIGI — CUSIP → 티커', kind: 'openfigi', url: 'https://www.openfigi.com/api', cadence: '필요할 때', key_env: 'OPENFIGI_API_KEY', status: 'UNAVAILABLE', status_note: '첫 수집 전(키 없이도 분당 25회)' }),
  src({ source_id: 'prices:twelvedata', manager_id: null, label: 'Twelve Data — 주가 · ETF · 분할', kind: 'prices', url: 'https://twelvedata.com/pricing', cadence: '일', key_env: 'TWELVEDATA_API_KEY', status: 'UNAVAILABLE', status_note: '키 필요: twelvedata.com 무료 Basic(하루 800 크레딧 · 분당 8회)' }),
  src({ source_id: 'prices:sec13f', manager_id: null, label: '13F 평가액 ÷ 주식 수 = 분기말 파생 가격', kind: 'prices', url: 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets', cadence: '분기', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'fx:frankfurter', manager_id: null, label: 'ECB 기준환율(frankfurter)', kind: 'fx', url: 'https://frankfurter.dev', cadence: '영업일', key_env: null, status: 'UNAVAILABLE', status_note: '첫 수집 전' }),
  src({ source_id: 'manual', manager_id: null, label: '대표 손 입력(공식 자료 · 출처 필수)', kind: 'manual', url: 'https://chairman-os-eosin.vercel.app/investment/sources', cadence: '수시', key_env: null, status: 'LIVE', status_note: null }),
]

export const SEED_SETTINGS: InvSettings = {
  collect_daily_limit: 600,
  data_quality_min: 70,
  monthly_budget_krw: 1_000_000,
  alloc_equity_pct: 60,
  alloc_bond_pct: 30,
  alloc_cash_pct: 10,
  weights: { ...DEFAULT_WEIGHTS },
  ai_daily_calls: 20,
  ai_monthly_usd: 30,
  updated_at: '2026-10-25T00:00:00Z',
}
