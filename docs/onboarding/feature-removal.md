# 빼기 안내서 — 새 기능 끄기 · 반영에서 빼기

대표 결정(2026-10-12): «대표 허락 없이 끝까지 만든다. 대표가 나중에 뺀다.» 그래서 새 기능마다 두 가지 길이 있다.

1. **끄기(스위치)** — 코드는 그대로 두고 화면 · 메뉴 · 동작만 막는다. 바로 되돌릴 수 있다.
   주소: https://chairman-os-eosin.vercel.app/settings/features (대표만). 기능마다 «켜기» 칸을 끄고 이유를 적고 «저장».
   보는 범위만 좁히려면(전원 → 임원 이상 → 대표만) «보는 범위»를 바꾼다. 회사 하나만 다르게 하려면 «범위»에서 회사를 고른다.
   끄면 **대표에게도** 꺼진다. 바꿀 때마다 감사 기록(audit_log · entity_table = feature_switches)에 한 줄.
   0073이 아직 DB에 없으면 스위치 화면은 «기본값으로 동작»만 보여 주고 바꾸기는 막힌다.
2. **반영에서 빼기** — 그 기능의 브랜치를 합치지 않고, 그 마이그레이션을 올리지 않는다. 뒤 번호가 앞 번호에 기대면 함께 빠진다(아래 표).

판정 규칙은 `src/lib/features.ts`(앱) · `supabase/migrations/0073_feature_switches.sql`의 `feature_on()`(DB) 한 곳씩이다.
스위치가 막는 곳: 화면(범위 밖이면 404) · 사이드바 메뉴 · Server Action(«지금은 쓸 수 없는 기능입니다»). DB 정책은 그대로다(스위치는 화면 · 동작 스위치).

## 브랜치 · 마이그레이션 의존 표 (뒤에 붙는 단계는 이 표에 줄을 더한다)

| 번호 | 브랜치 | 기대는 것 | 이것을 빼면 함께 빠지는 것 |
|---|---|---|---|
| 0069 | release/ai-assist | 0068 | 없음(0070부터는 0069에 기대지 않는다 — 번호만 이어짐) |
| 0070 | release/finance-upload-v2 | 0068 | 0072 · C단계 |
| 0071 | release/process-charts (pchart) | 0068 | 없음 |
| 0072 | feat/finance-v21 | **0070** | C단계 |
| C단계(마이그레이션 없음) | feat/finance-pdf | **0072** 코드 | 없음 |
| 0073 | feat/feature-switches | 0072까지의 코드(스위치가 그 화면들을 가린다) | **뒤의 모든 단계**(새 RPC가 `feature_on`을 부른다) |
| 0074 | feat/finance-pdf-rest | 0072 · 0073 | 없음(0075는 0074 트리거를 쓰지 않는다 — 번호만 이어짐) |
| 0075 | feat/monthly-pl | **0072**(평가금액 · 기초 · 출고 · 같은 거래 · 재마감 대상 표) · **0073**(feature_on) · 0016/0047(장부 · can_*_books) | 없음(PHASE 7 · 8이 이 값을 쓰게 되면 그 줄에 적는다) |
| 0076 | feat/b-rest | **0072**(fin_inventory_openings · fin_inventory_roll · fin_closed_gate · fin_reclose_mark · fin_audit) · **0073**(feature_on) · 0061(cost_purchase_candidates · cost_can) | 없음 |
| 0077~0079 | feat/sales-margins · feat/cost-candidates · feat/ledger-post | 0073 · 0067 · 0075 · 0070/0072 | 각 절 참고 |
| (마이그레이션 없음) | feat/chair-dashboard | 0073(chairman_dashboard 기본 줄) · 0075(fin_pl_month) · 0070(fin_uploads) | 없음 |
| 0081 | feat/blueprint-skeleton | 0061~0067(원가 엔진 표 · cost_secret 문 · 판매) · **0073**(feature_on · 스위치 표) · 0015(fx_rates) — 0075 · 0080은 쓰지 않는다(번호만 이어짐) | 없음(스위치 일곱 · 표 넷 · RPC 열일곱이 함께 빠진다) |

번호를 건너뛰어 올리면 안 된다: Supabase는 번호 순서로 올린다. 가운데를 빼려면 그 뒤 번호의 파일 이름을 다시 매기는 작업이 필요하다 — 그 일은 이 안내서 밖(반영 담당이 브랜치를 다시 짠다).

## 기능별

### ai_assist — AI 어시스턴트 보강 (0069)
- 끄는 법: /settings/features → «AI 어시스턴트 보강» 끄기. 답마다 «보완 의견 남기기» 칸 · /settings/feedback(시스템 보완함) · 설정 목록의 «시스템 보완함» 줄이 사라진다. 어시스턴트 자체(묻기 · 답 · 권한 조회 도구)는 그대로.
- 반영에서 빼는 법: release/ai-assist를 합치지 않고 0069를 올리지 않는다. 뒤 번호 0070 · 0071 · 0072는 0069 표 · 함수를 쓰지 않는다(번호만 다시 매기면 된다).
- 빼면 사라지는 것: 권한 · 조직 조회 도구, 보완 의견, 보완함, 밤의 의견 정리.
- 남는 데이터: (끄기) ai_feedback · ai_feedback_bundles 줄은 그대로 남는다. (빼기) 0069 전이면 표가 없다.

### finance_upload — 자료 올리기 (0070 · 0072)
- 끄는 법: «자료 올리기» 끄기. /finance/<회사>/upload · /finance/<회사>/valuation이 404, 올리기 · 넣기 · 되돌리기 · 평가금액 · 출고 결정 · 같은 거래 · 재마감 풀기 동작이 거부된다. **그 화면 아래 «그 밖»(DY 엑셀 계정과목 · 월별 손익 · 공식 결산)도 같이 가려진다** — 끄는 동안 쓰려면 회사 줄로 대표만 켜 둔다.
- 반영에서 빼는 법: release/finance-upload-v2 · feat/finance-v21 · feat/finance-pdf를 합치지 않는다. 0070 · 0072를 올리지 않는다(0072는 0070 표를 고친다 — 0070만 빼고 0072를 올릴 수 없다).
- 빼면 사라지는 것: 14 + 4가지 자료 올리기, 미리보기 대기, 평가금액, 기초재고 연결, 원료 출고 구분, 같은 거래 묶음, 재마감 대상, PDF · 사진.
- 남는 데이터: (끄기) fin_uploads · fin_*_lines · fin_inventory_valuations 등 그대로, 넣은 값은 장부에 그대로. (빼기) 표가 없다. 0072 시드 예시 표시(is_example)도 없다.

### finance_docs — PDF · 사진 읽기 (C단계, 마이그레이션 없음)
- 끄는 법: «PDF · 사진 읽기» 끄기(기본 대표만). 자료 올리기에서 PDF · 사진은 «준비 중» 카드, 엑셀은 그대로.
- 반영에서 빼는 법: feat/finance-pdf(5acf8e0)를 합치지 않는다. DB는 그대로(마이그레이션 없음).
- 빼면 사라지는 것: 글 PDF 칸 읽기, 스캔 PDF · 사진 AI 읽기, 세무사 결산 → 공식 결산 미리보기.
- 남는 데이터: (끄기) 이미 넣은 줄은 그대로. AI 사용 기록(ai_usage_log) 그대로.

### process_charts — 프로세스 차트 (0071)
- 끄는 법: «프로세스 차트» 끄기. /process-charts가 404, 사이드바 «프로세스 차트» · 설정 목록 줄이 사라지고 «지금 동기화»가 거부된다.
- 반영에서 빼는 법: release/process-charts를 합치지 않고 0071을 올리지 않는다. 뒤 번호는 0071에 기대지 않는다.
- 빼면 사라지는 것: 팀별 시트 화면, 업무 관리 · 캘린더 동기화.
- 남는 데이터: (끄기) 동기화로 들어온 업무(tasks)는 업무 관리에 그대로 남는다 — 지우지 않는다. 동기화 기록 그대로.

### intake — 자료 받는 입구 (0058)
- 끄는 법: «자료 받는 입구»(기본 대표만). 범위 밖 사람의 회사 화면은 예전 «첨부» 칸, 입구 동작은 전부 거부. 직원에게 열려면 «보는 범위»를 «전원»으로(예전 `INTAKE_OPEN_TO_STAFF = true`와 같다).
- 반영에서 빼는 법: 이미 운영에 있다(0058) — 빼지 않고 끈다.
- 남는 데이터: intake_items · 첨부 그대로.

### monthly_pl — 월별 손익 재고 반영 (0075 · feat/monthly-pl)
- 끄는 법: /settings/features → «월별 손익 재고 반영» 끄기(기본 대표만). /finance/<회사>/monthly 아래 «월별 손익 — 재고 반영» 패널이 사라지고 화면은 예전 «월별 간이 손익» 그대로다. 잠정 저장 · 내부 마감 · 다시 열기 · 조정 · 설정 동작은 서버 액션과 DB(0075 RPC 첫 줄 feature_on)가 둘 다 거부한다.
- 직원에게 열기: «보는 범위»를 «전원»(또는 회사 줄)으로. 여는 사람에게 장부 읽기(can_read_books)가 있어야 보이고, 원료별 줄은 대표 · 원가 관리('/costing/<회사>')에게만 간다.
- 반영에서 빼는 법: feat/monthly-pl을 합치지 않고 0075를 올리지 않는다. 0075는 0072 표 · 0073 feature_on에 기대므로 그 둘 없이 올릴 수 없다. 0075가 바꾸는 0072의 것은 fin_reclose_flags 까닭 제약 한 줄('pl_reopen' 더함)뿐이다.
- 빼면 사라지는 것: 재고 반영 매출원가 · 원료별 월 가중평균 · 손익과 현금 분리 · 재고 조정(보정값 · 사유) · 잠정 저장 · 내부 마감 · 다시 열기 · 재마감 대상 표시(pl_reopen) · 설정(평가방법 · 허용오차 · 매출 원천 · 원료 대금 항목).
- 남는 데이터: (끄기) fin_pl_closes · fin_pl_adjustments · fin_pl_settings 줄이 그대로 남는다 — 장부 · finance_kpis · 0072 표는 이 기능이 고친 적이 없다. (빼기) 0075 전이면 표가 없다. 0075 뒤에 빼려면 표 셋을 지우는 새 마이그레이션이 필요하다(지우기는 대표 확인 — 되돌릴 수 없다).

### B 남은 것 (0076 · feat/b-rest — 새 스위치 없음, «자료 올리기» 스위치 아래)
- 끄는 법: 새 스위치를 만들지 않았다. «자료 올리기»(finance_upload)를 끄면 첫 달 기초 «확인» 단추 · «일부 미입력» 표시 · «달 넘김 의심» 칸 · 되돌리기 범위 문구가 화면과 함께 사라지고, fin_opening_confirm은 DB가 거부한다(첫 줄 feature_on). «예시» 꼬리표(/tasks · /approvals · 회사 화면 프로젝트 목록 · 프로젝트 제목)는 대표에게만 보이며 스위치가 없다 — 빼려면 코드에서 `ExampleTag` 줄을 지운다.
- 반영에서 빼는 법: feat/b-rest를 합치지 않고 0076을 올리지 않는다. 0076 없이도 앱은 선다 — 연결 표의 새 칸은 비고(null · 0), 확인 단추는 나오지 않으며, 달 넘김 의심 · 예시 꼬리표 · 되돌리기 문구는 DB와 무관하다(앱만).
- 빼면 사라지는 것: 첫 달 기초 확인(입력자 ≠ 확인자), 원재료 기초 «일부 미입력», cost_purchase_candidates의 예시 거름(0061 본문으로 돌아간다), 달 넘김 의심(자동 넣기 멈춤 포함).
- 남는 데이터: (끄기) fin_inventory_openings.confirmed_by · confirmed_at 값이 그대로 남는다. (빼기) 0076 전에는 그 칸이 늘 비어 있다(0072가 만든 칸 — 표는 바뀌지 않는다). 0076 뒤에 빼려면 fin_inventory_roll을 0072 모양으로 다시 만드는 새 마이그레이션(drop + create)이 필요하다.

### sales_margins — 판매 실적 · 마진 화면 (0077 · feat/sales-margins)
- 끄는 법: /settings/features → «판매 실적 · 마진 화면» 끄기(기본 대표만). /sales/<회사>/deals · /costs/<회사>/margins가 404가 되고 /sales/<회사> · /costs/<회사>의 링크가 사라진다. RPC sales_deals · sales_margins도 첫 줄 feature_on으로 거부한다('feature_off' — 대표 포함).
- 직원에게 열기: «보는 범위»를 «전원»(또는 회사 줄)으로. 판매 실적은 '/sales/<회사>' 줄이 있는 영업 본인 · 영업 팀장(팀)에게, 마진은 '/costing/<회사>' 줄(원가 관리 — 1원 · 하루 20번 · 부를 때마다 기록)에게만 보인다.
- 반영에서 빼는 법: feat/sales-margins를 합치지 않고 0077을 올리지 않는다. 0077은 0067(판매 표 · cost_margins) · 0073(feature_on) · 0075(fin_pl_closes)에 기댄다. 0077 없이 앱만 나가면 두 화면은 «준비 중»(sales_margins_unavailable).
- 빼면 사라지는 것: 영업 판매 실적 목록(판매가 · kg · 등급) · 견적 마진 vs 실제 마진(일 · 주 · 월 · 분기 · 년 · 제품 · 고객 · 전체 · 판매 한 줄) · «잠정 대체원가 / 확정 매출원가 기준» 표시. 0067 표 · 함수는 그대로 남는다(0067 cost_margins를 직접 부르는 길도 그대로).
- 남는 데이터: 없음(0077은 표를 만들지 않는다). 부를 때마다 남긴 감사 줄(audit_log 'margins:<회사>')과 하루 셈(cost_secret.cost_reads)은 0067 것과 같은 자리에 남는다.

### cost_candidates — 원가 후보 승인 (0078 · feat/cost-candidates)
- 끄는 법: /settings/features → «원가 후보 승인» 끄기(기본 대표만). /costs/<회사>/candidates가 404가 되고 /costs/<회사>의 링크가 사라진다. RPC cost_fin_candidates · cost_fin_candidate_decide도 첫 줄 feature_on으로 거부한다('feature_off' — 대표 포함).
- 직원에게 열기: «보는 범위»를 «전원»(또는 회사 줄)으로. 그래도 '/costing/<회사>' 쓰기 줄(원가 관리)이 있는 사람만 보인다. 넣기는 구매 쓰기(② · ⑦) · 영업 쓰기(①) 줄도 필요하다.
- 반영에서 빼는 법: feat/cost-candidates를 합치지 않고 0078을 올리지 않는다. 0078은 0061(LOT) · 0067(sale_record) · 0070 · 0072(fin_* 줄) · 0073(feature_on)에 기댄다. 0078 없이 앱만 나가면 화면은 «준비 중»(cost_candidates_unavailable).
- 빼면 사라지는 것: 자료 올리기 ② · ⑦ · ① 줄을 원가 엔진으로 옮기는 화면. 원가 엔진의 원래 입력(구매 LOT 화면 · 엑셀 넣기)은 그대로.
- 남는 데이터: 결정 표 cost_fin_candidate_decisions(빼려면 표를 그대로 두거나 보관 — 지우지 않는다) · 그 결정으로 만든 LOT(source 'import' · source_ref 'fin_*:<줄>') · 판매 실적(0067) · audit_log 줄.

### ledger_post — 원장 → 장부 반영 (0079 · feat/ledger-post)
- 끄는 법: /settings/features → «원장 → 장부 반영» 끄기(기본 대표만). /finance/<회사>/ledger-post가 404가 되고 자료 올리기 화면의 링크가 사라진다. RPC ledger_post_stage · apply · void · queue도 첫 줄 feature_on으로 거부한다('feature_off' — 대표 포함).
- 직원에게 열기: «보는 범위»를 «전원»(또는 회사 줄)으로. 그래도 장부 쓰기(can_keep_books — 대표 · CFO · 회사 대표 · 재무 쓰기 줄)만 보인다. 마감 달은 대표 · 그룹 CFO만.
- 반영에서 빼는 법: feat/ledger-post를 합치지 않고 0079를 올리지 않는다. 0079는 0016(전표 · 정정) · 0070 · 0072(원장 줄 · 같은 거래 묶음) · 0073(feature_on) · 0075(fin_pl_closes)에 기댄다. 0079 없이 앱만 나가면 화면은 «준비 중»(ledger_post_unavailable).
- 빼면 사라지는 것: 원장 줄을 장부 전표로 넣는 2단계 화면. 이미 넣은 전표는 장부(journal_entries · journal_lines)에 그대로 남는다 — 되돌리려면 빼기 전에 «무효 처리»(역분개)로.
- 남는 데이터: fin_ledger_posts · fin_ledger_post_lines(지우지 않는다) · 반영 · 역분개 전표 · audit_log 줄.

### chairman_dashboard — 대표 대시보드 (feat/chair-dashboard · 마이그레이션 없음)
- 끄는 법: /settings/features → «대표 대시보드» 끄기(기본 대표만). 대표 홈(/)의 «대표 대시보드 — 손익 · 매출 · 현금 추이» 칸이 사라진다(서버에서 판정 — 꺼지면 월별 손익 · 자료 올리기를 읽지도 않는다).
- 직원에게 열기: 의미 없음 — 대표 홈(/)은 대표만 들어온다(다른 역할은 /me로).
- 반영에서 빼는 법: feat/chair-dashboard의 대시보드 커밋을 합치지 않는다(`src\components\dashboard\chair-dashboard.tsx` · `src\lib\chair-dashboard.ts` · 홈 한 줄). 같은 브랜치 첫 두 커밋(0075 · 0077 · 0078 · 0079 리뷰 고침)은 따로 합칠 수 있다.
- 빼면 사라지는 것: 월 · 분기 · 년 추이 표 · 14가지 자료 달력. 월별 손익 · 판매 마진 화면은 그대로.
- 남는 데이터: 없음(읽기만).

### 청사진 뼈대 일곱 (0081 · feat/blueprint-skeleton — 공통)
- 반영에서 빼는 법: feat/blueprint-skeleton을 합치지 않고 0081을 올리지 않는다. 0081은 0061~0067 · 0073에 기대고, 0001~0080의 표 · 함수 · 정책을 하나도 고치지 않는다 — 빼도 앞 번호는 그대로 선다. 일곱 기능은 한 파일이라 하나만 빼려면 스위치로 끈다.
- 0081 뒤에 빼려면: 새 마이그레이션으로 RPC 열일곱 · cost_secret 내부 함수(outlook_calc · mat_code · diag_card · forecast_unit · forecast_material · forecast_complete · sale_costs · bridge_calc · competitor_calc)를 drop하고, 표 넷(cost_market_outlook · cost_forecast_settings · cost_competitor_assumptions · cost_work_orders)은 보관하거나 지운다(지우기는 대표 확인 — 되돌릴 수 없다). 스위치 줄 일곱은 남겨도 해가 없다.
- 직원에게 열기(공통): «보는 범위»를 «전원»(또는 회사 줄)으로. 그래도 아래 기능마다 적은 원가 엔진 줄('/purchasing · /production · /sales · /costing/<회사>')이 있어야 보인다. 원가 값은 0062 문(원가 관리 하루 20번 · 부를 때마다 기록 · 영업 0시 · 200건 · 구매 쓰기 겸직 거부)을 지난다.

### cost_forecast — Forecast 원가 (0081)
- 숨기는 것: 원료 다음 달 시장 전망 넣기 · 목록(cost_outlook_set · cost_outlook_list), Forecast 설정(cost_forecast_setting_set · cost_forecast_setting), 제품별 Forecast 원료비 · 총원가(cost_forecast_list).
- 끄는 법: /settings/features → «Forecast 원가» 끄기(기본 대표만). RPC 다섯이 첫 줄에서 'feature_off'(대표 포함).
- 남는 데이터: (끄기) cost_market_outlook · cost_forecast_settings 줄 그대로. 월별 손익(0075)에는 처음부터 들어가지 않는다.

### purchase_performance — 구매 성과 (0081)
- 숨기는 것: LOT · 원료 · 공급처 · 월별 구매가 vs 그날 시장가 · 절감액 · 환율 효과(purchase_performance). 대표 · 구매 · 원가 관리 · CFO = 모든 묶음, 회사 대표 · 임원 = 월 묶음만.
- 끄는 법: «구매 성과» 끄기(기본 대표만). RPC가 'feature_off'.
- 남는 데이터: 없음(읽기만). 대표 외 조회 감사 줄(audit_log 'performance:<회사>')은 남는다.

### customer_profit — 고객별 수익성 (0081)
- 숨기는 것: 고객별 매출 · 매출원가 · GM · 등급(customer_profit — 영업은 본인 판매의 매출 · 등급만)과 «매출 큰데 마진 낮은» 고객 · 제품(customer_profit_watch — 대표 · 원가 관리).
- 끄는 법: «고객별 수익성» 끄기(기본 대표만). RPC 둘이 'feature_off'.
- 남는 데이터: 없음(읽기만 — 0067 판매 표를 읽는다). 하루 셈 · 감사 줄('customers:<회사>')은 0062 자리에 남는다.

### margin_bridge — 마진 변동 분해 (0081)
- 숨기는 것: 두 기간 GM 원/kg 변화를 판매가 · 원료 · 제조 · 물류 · 기타 효과로 나눈 값(margin_bridge — 대표 · 원가 관리, 원료별은 대표만).
- 끄는 법: «마진 변동 분해» 끄기(기본 대표만). RPC가 'feature_off'. 제품 진단의 «마진 하락 이유» 카드는 제품 진단 스위치를 따른다(같은 계산).
- 남는 데이터: 없음(읽기만).

### competitor_price — 경쟁사 가정 (0081)
- 숨기는 것: 경쟁사 가정 넣기 · 목록(competitor_assumption_set · competitor_assumption_list — 원가 관리 · 대표)과 경쟁사 예상 최소가 · 우리 목표가 · 그 값에서 우리 마진(competitor_price — 영업은 결과만).
- 끄는 법: «경쟁사 가정» 끄기(기본 대표만). RPC 셋이 'feature_off'.
- 남는 데이터: (끄기) cost_competitor_assumptions 줄 그대로.

### work_orders — 작업지시 (0081)
- 숨기는 것: 오더별 탱크 · 순서 · 담당 · 원료 이름 가림(work_order_set — 대표), 작업지시 한 장(work_order_get — 대표 · 담당 생산 직원, 원료 코드 · 배치 kg · 투입), 본인 담당 목록(work_order_mine).
- 끄는 법: «작업지시» 끄기(기본 대표만). RPC 셋이 'feature_off'. 0064 오더 · 작업지시 수량 표 자체는 그대로(생산은 0064 정책대로 표를 읽는다 — DEFERRED «담당자로 좁히기»).
- 남는 데이터: (끄기) cost_work_orders 줄 그대로.

### product_diagnosis — 제품 진단 (0081)
- 숨기는 것: 제품 한 장의 진단 카드(product_diagnosis — 대표 11장 · 원가 관리 10장 · 영업 4장)와 기간별 추이(product_trend — 대표 · 원가 관리).
- 끄는 법: «제품 진단» 끄기(기본 대표만). RPC 둘이 'feature_off'.
- 남는 데이터: 없음(읽기만). 하루 셈 · 감사 줄은 0062 자리에 남는다.

### purchase_price_report — 가격 리포트(구매 · 0084)
- 숨기는 것: 구매 메뉴 «가격 리포트»(/purchasing/<회사>/price-report — 리포트 · 지난 리포트 · 사건 · 뉴스 · «지금 업데이트»), 구매 개요 요약 카드, 시장가 화면 «참고: 오늘 나프타 · 원유» 한 줄.
- 끄는 법: «가격 리포트(구매)» 끄기(기본 «전원» — DB 읽기 규칙이 구매 줄 · 대표 · 임원 이상으로 거른다). 끄면 표 넷이 대표에게도 0행, 버튼 RPC(price_report_request)가 'price_report_denied'. AI Agent(GitHub Actions)는 계속 수집 · 저장한다 — 자동 수집까지 멈추려면 GitHub → Actions → «Macro briefing» → «Disable workflow».
- 빼는 법(브랜치): feat/purchase-price-report를 합치지 않는다 — 0084 · macro/ · .github/workflows/macro-briefing.yml이 함께 빠진다.
- 남는 데이터: (끄기) purchase_price_reports · points · events · runs 줄 그대로. 원가 엔진 표(cost_market_prices)에는 아무것도 들어가지 않았다.

### 다음 단계 기능(스위치 줄만 먼저 있음 — 화면은 아직 없다)
- 0081 일곱(cost_forecast · purchase_performance · customer_profit · margin_bridge · competitor_price · work_orders · product_diagnosis) — DB · RPC · 스위치만 있고 화면은 다음 블록.

새 기능을 만들 때: ① `src/lib/features.ts` FEATURES에 한 줄 ② 새 마이그레이션에 그룹 기본 줄 insert(0073 3절 모양, `on conflict do nothing`) ③ 새 RPC 첫 줄 `if not feature_on('키', 회사) then raise exception 'feature_off' using errcode = '42501'; end if;` ④ 화면 `featureOn(user, '키', 회사)` → notFound · 메뉴는 `FEATURE_NAV` ⑤ 이 안내서 표에 줄.

## 스위치 자체(0073)를 빼면
feat/feature-switches를 합치지 않으면 화면 · Server Action은 이 브랜치 전 상태(입구 스위치 = 코드 상수 · 나머지는 늘 켜짐)로 돌아간다.
0073 뒤의 단계는 `feature_on`을 부르므로 **0073 없이 올릴 수 없다**.
앱만 먼저 나가고 0073이 DB에 없으면: 앱은 기본값(위 표의 기본 범위)으로 동작한다 — 화면이 사라지지 않는다.
