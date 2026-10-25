# Investment Intelligence — 설계도 (0094~0096)

원문: `docs/specs/2026-10-24-investment-intelligence.txt` (머리말 + PART 0~20). 진행: `docs/specs/investment-progress.md`.

## 1. Phase 0 점검 결과 (2026-10-25)

| 원문이 묻는 것 | 실제 |
|---|---|
| CAPITAL 메뉴 | 코드에 없다. `docs/chairman-architecture-v1.md`의 «사이드바 10개 개편(블록 E)» 그림에만 있다. → 새 그룹 `grp_capital`(제목 CAPITAL) + 펼침 항목 `nav_investment`(Investment Intelligence) + 하위 8개. 같은 기능이 없어 중복 없음. |
| 저장소 | `ChairmanRepository`(live `supabase.ts` · dummy `dummy.ts`). 새 모듈은 0088 기억 엔진 방식 — `src/lib/investment/store.ts`의 `InvestmentMethods`를 펼쳐 넣는다. |
| Dummy/Live | `NEXT_PUBLIC_DATA_MODE`. 이 모듈은 그 위에 **데이터 상태 다섯**(LIVE · PARTIAL · DEMO · UNAVAILABLE · DISABLED)을 칸마다 따로 단다. Demo 숫자는 코드(`demo.ts`)에만 있고 DB에 넣지 않는다. 화면은 DEMO 띠를 단다. |
| 권한 | `auth_role()` · `is_active()` · `user_module_access`(지정자). 시스템 계정은 0013 restrictive 방식. 운영에 AIAgent · Integration 계정 둘 다 있음(로그인 확인). |
| 기능 스위치 | 0073 `feature_switches` · `featureOn` · `FEATURE_NAV`. |
| AI | `ai_usage_log`(0045) · `pricing.ts` · 구조 강제 물러서기(BadRequest 한 번). 예약 함수 · settings 표는 없다 → 0095에서 만든다. |
| 전자결재 | 0087 `ea_forms` 시드 줄 하나 = 양식 하나. 승인 완료 신호는 `ea_docs.status='approved'`뿐(콜백 없음). |
| 0093 의존 | 투자 승인 양식은 0093에 기대지 않는다 — 0093은 읽기 함수(ea_doc · ea_list)의 이름 가림이라 새 양식도 자동으로 «대표». 0093은 2026-10-25 운영 반영 완료. |
| 차트 | 라이브러리 없음, 손으로 그린 SVG(`metric-trend-chart.tsx`). 같은 방식으로 `InvestChart`를 만든다. |
| cron | `vercel.json` crons(1줄) + `isCronAuthorized`(CRON_SECRET). 투자 수집 한 줄을 더한다. |
| 재무 자금 전망 | `/finance` 지표 8(자금 전망 3개월) · 12(투자 여력) = `lib/finance-overview/kpis.ts computeKpis`. DY Portfolio가 읽기만 한다. |

## 2. 데이터 경로 (무료 · 공식)

| 기관/데이터 | 경로 | 주기 · 날짜 | 상태 |
|---|---|---|---|
| Berkshire | SEC 13F-HR (CIK 0001067983) infotable | 분기말 = data_as_of, 제출일 = source_published_at | LIVE (13F 대상 미국 증권만 — «Total Portfolio» 아님) |
| NBIM | ① nbim.no `api/investments/v2/<날짜>.json` 전체 보유(반기 · 평가액 · 지분율 · 국가 · 업종, 주식 수 없음) ② SEC 13F Norges Bank(CIK 0001374170, 미국분 주식 수) | ① 반기말 ② 분기말 | ① LIVE(주식 수 없음 → 계속 보유는 UNKNOWN, NEW/EXIT만) ② LIVE |
| Fundsmith | SEC 13F Fundsmith LLP(CIK 0001569205) · 공식 Factsheet(사이트가 Cloudflare로 자동 수집 차단) | 분기 · 월 | 13F LIVE · Factsheet UNAVAILABLE(자동) → 대표 손 입력(출처 · 기준일 필수) |
| Pershing | SEC 13F Pershing Square Capital Management(CIK 0001336528) · pershingsquareholdings.com(403) | 분기 | 13F LIVE(운용사 13F ≠ PSH 펀드 전체) · 사이트 UNAVAILABLE → 손 입력 |
| 재무 | SEC XBRL companyfacts (관심 종목만) | 공시 | LIVE |
| CUSIP → 티커 | OpenFIGI(무료, 키 없으면 분당 25회) `OPENFIGI_API_KEY` 선택 | — | LIVE |
| 주가 · ETF · 분할 | Twelve Data `TWELVEDATA_API_KEY`(무료 Basic: 하루 800 크레딧 · 분당 8회) | 일 | 키 없으면 UNAVAILABLE. 대신 13F 평가액÷주식수 = 분기말 파생 가격(출처 13F, PARTIAL) |
| 환율 | frankfurter(ECB, 키 없음 · 기존 lib/fx.ts와 같은 곳) | 영업일 | LIVE |

SEC Fair Access: User-Agent = env `SEC_USER_AGENT`(비면 «DY Industry chairman-os» + 화면 안내), 초당 4회 이하, 429/5xx는 1·2·4초 뒤 다시.
하루 호출 한도 = `investment_settings.collect_daily_limit`(기본 600). 실패해도 마지막 성공 시각을 남긴다.

## 3. 판정 규칙 (결정론 — AI 없음)

- NEW: 이전 공시에 없고 최신에 있음. EXIT: 이전에 있고 최신 공개 범위에 없음. HOLD: 보정 후 수량 같음.
- ADD/TRIM: Net = 보정 현재 − 보정 이전, % = Net / 보정 이전 × 100. **주식 수만 본다 — 평가액은 판정에 쓰지 않는다**(주가 상승 ≠ 매수).
- 분할 보정: `security_corporate_actions`에 두 기준일 사이 분할이 있으면 이전 수량 × 비율. 기록이 없는데 수량비가 2·3·4·5·10·20(또는 그 역수)에 맞고 13F 파생 가격비가 그 역수에 맞으면 **분할 의심 → UNKNOWN**(«기업행위 자료 필요»). 매수 · 매도로 세지 않는다.
- 같은 CUSIP 여러 줄(운용 단위 · discretion)은 합친다. 옵션(put/call) 줄은 주식 판정에서 뺀다.
- 13F/A: RESTATEMENT는 원본을 대신, NEW HOLDINGS는 원본에 더한다.
- NBIM 전체 목록: 수량이 없으니 계속 보유 = UNKNOWN(지분율 변화는 참고로만), NEW/EXIT는 목록 기준.
- 낮은 확신: NBIM(지수형) 신호 가중치 0.5 — 공통 보유 · Institutional Signal에서.

## 4. 표 (PART 14 논리 모델 → 실제 migration)

모든 원천 표: `source_url · source_type · source_published_at · data_as_of · ingested_at · updated_at · currency · data_quality · is_demo` 중 해당 칸.
계산 표: `calculation_version`. AI 표: `model_version`.

| 논리 이름 | 단계 | 실제 | 쓰는 쪽 |
|---|---|---|---|
| investment_managers | 0094 | 표 | 대표(시드) |
| investment_sources | 0094 | 표(수집 상태 · 마지막 성공 · 오늘 호출) | 수집 |
| investment_disclosures | 0094 | 표 | 수집 · 대표(손 입력) |
| investment_positions | 0094 | 표 | 수집 · 대표 |
| investment_position_changes | 0094 | 표(판정 결과 · 판정 버전) | 수집 |
| securities | 0094 | 표(주식 · ETF · 환율 의사종목) | 수집 · 대표 |
| security_prices | 0094 | 표 | 수집 |
| security_corporate_actions | 0094 | 표 | 수집 · 대표 |
| etf_holdings | 0094 | 표 | 수집 · 대표 |
| company_financials | 0094 | 표(XBRL fact 그대로 · 공시번호별 이력) | 수집 |
| company_metrics | 0094 | 표(ETF 총보수 · AUM · 추적오차 등 기준일 있는 값, 손 입력 포함) | 수집 · 대표 |
| investment_collect_runs | 0094 | 표(수집 기록) | 수집 |
| investment_settings | 0094 | 한 줄 표 | 대표 |
| investment_audit_logs | 0094 | 표(덧붙이기만) | 모두(자기 이름으로) |
| future_markets · market_research_sources · market_forecasts · market_value_chains | 0095 | 표 | 대표(출처 · 발표일 필수) |
| investment_theses · investment_thesis_evidence | 0095 | 표 | 대표 · AI(INSERT만) |
| investment_scenarios · investment_valuations · investment_scores · investment_recommendations | 0095 | 표(추천 · 가치평가는 불변 — UPDATE/DELETE 없음, 재분석 = 새 버전 행) | 대표 · AI(INSERT만) |
| investment_ai_reservations | 0095 | 표 + `investment_ai_reserve()` 원자적 예약 | AI · 대표 |
| investment_alerts | 0095 | 표 | 수집 · AI · 대표 |
| paper_portfolios · paper_transactions | 0096 | 표 | 대표 |
| corporate_investment_accounts · corporate_transactions · corporate_investment_approvals | 0096 | 표 | 대표만(시스템 계정 0행) |
| recommendation_outcomes | 0096 | 표 | 대표 · AI(INSERT만) |

## 5. 권한 (화면 숨김 · 서버 API · RLS 셋 다)

SQL 손잡이(0094): `inv_reader()` = 사람 · 활성 · (대표 또는 `user_module_access.module='/investment'` 지정자) · `inv_admin()` = 대표 ·
`inv_collector()` = 활성 Integration · `inv_analyst()` = 활성 AIAgent.

| 표 묶음 | 읽기 | 쓰기 |
|---|---|---|
| 원천(0094 표 전부) | reader · collector · analyst | collector · admin — insert/update만, delete grant 없음. AIAgent는 restrictive로 막음 |
| 분석 · 추천(0095) | reader · analyst | analyst · admin — **insert만**(update · delete grant 없음 + 트리거로 막음). Integration은 restrictive로 막음 |
| 포트폴리오 · 거래 · 승인(0096) | reader | admin만. 시스템 계정 0행(읽기도) |

직원 · anon: 전부 0행. 화면은 `redirect('/me')`, API는 403.

## 6. 화면 (CAPITAL › Investment Intelligence)

`/investment` Dashboard · `/investment/radar` Investor Radar(+ `/investment/radar/[manager]`) · `/investment/markets` Future Markets ·
`/investment/securities` Stock & ETF 360(+ `/[id]`) · `/investment/engine` AI Investment Engine · `/investment/recommendations` ·
`/investment/portfolio` DY Portfolio · `/investment/performance` Performance & Learning · `/investment/sources` 데이터 상태(수집 · 손 입력).
