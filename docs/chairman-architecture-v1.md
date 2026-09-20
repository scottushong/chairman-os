# Chairman Architecture v1.0

> 회장이 2026-09-21에 준 원문이다. **이 문서는 Phase 7의 바인딩 권위다.**
> 문구를 다듬지 않는다 — 계획이 스펙과 어긋날 때 판정의 기준이 이 글자들이다.
> (원래 `/mnt/user-data/uploads/코드_txt.txt`로 주려던 것인데 그 경로가 이 기계에 없어 본문으로 받았다.)

---

## 0. 무엇을 바꾸는가

Chairman OS의 중심 개념을 바꾼다.

지금까지는 "내가 모든 회사를 볼 수 있는 Super ERP"에 가까웠다면, 앞으로는 "CEO들이 회사를 운영하고
나는 사람·자본·방향·예외만 보는 시스템"이다. 지금 만들고 있는 ERP/MES 연결은 버리는 게 아니라,
그 아래의 **데이터 레이어**가 된다.

### 첫 화면

```
┌──────────────────────────────────────────────────────────────┐
│ CHAIRMAN OS                              21 SEP 2026        │
│                                                              │
│ GROUP VALUE     CASH AVAILABLE     CAPITAL DEPLOYED     CEOs │
│  W xxx B          W xx B              W xx B            6   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              CHAIRMAN ATTENTION                              │
│                                                              │
│ RED    DY INDUSTRIAL    Margin down 3.2%   CEO decision needed │
│ YELLOW VANA             US expansion       W1.5B request       │
│ YELLOW THE DEOL         Launch D-63        Hiring issue        │
│                                                              │
│ Everything else is operating normally.                       │
├──────────────────────────────────────────────────────────────┤
│ COMPANY       CEO       REV      EBITDA    FCF     ROIC      │
│                                                              │
│ DY            Hong      000       00%      00      00%    Y  │
│ VANA          CEO A     000       00%      00      00%    G  │
│ THE DEOL      CEO B     000       00%      00      00%    G  │
│ HOF           CEO C      -         -       -        -     Y  │
│ BORAM         CEO D     000       00%      00      00%    G  │
├──────────────────────────────────────────────────────────────┤
│ CAPITAL ALLOCATION                                           │
│                                                              │
│ Available W12.8B                                             │
│                                                              │
│ DY Vietnam       W2.0B   Expected ROIC 19%   [REVIEW]        │
│ VANA US          W3.5B   Expected IRR  31%   [REVIEW]        │
│ Acquisition X    W5.0B   Expected IRR  24%   [REVIEW]        │
│ Cash             W2.3B                                       │
├──────────────────────────────────────────────────────────────┤
│ PEOPLE                                                       │
│                                                              │
│ CEO              TRUST   PERFORMANCE   AUTONOMY   SUCCESSION │
│ DY / Hong          -          -           -          38%     │
│ VANA / CEO A     4/5        4/5          L4          82%     │
└──────────────────────────────────────────────────────────────┘
```

(원문의 이모지 신호등과 원화 기호는 이 파일에서 글자로 옮겼다 — 뜻은 같다.)

여기서 특히 넣고 싶은 게 **Chairman Attention**이다.

Chairman이 Dashboard를 열었는데 50개 회사의 그래프부터 보이면 설계가 실패한 것이다. 시스템이 먼저
50개 회사의 ERP/MES/회계/영업 데이터를 읽고 "오늘 당신이 볼 필요가 있는 것은 이 세 가지입니다"라고
압축해서 올려줘야 한다.

### 회사 페이지도 기존 ERP처럼 만들면 안 된다

DY INDUSTRIAL을 누르면 맨 위가 이렇게 나온다.

```
DY INDUSTRIAL
CEO: Edison -> Succession in Progress

CEO AUTONOMY                         42%

Still dependent on Chairman
--------------------------------
Pricing decisions                 HIGH
Top 10 customer relationships     HIGH
R&D product decisions             MEDIUM
Vietnam investment                HIGH
Hiring                            LOW
Production                        LOW


90-DAY CEO TRANSFER
--------------------------------
[done] Production decisions
[done] Routine hiring
[done] Domestic sales management
[wip]  Pricing authority
[   ]  Key-account relationships
[   ]  Capital allocation
[   ]  Vietnam strategy


CHAIRMAN INTERVENTIONS
--------------------------------
Sep       27
Aug       34
Jul       41

Target: <10 / month
```

이것이 지금 겪고 있는 문제를 숫자로 만드는 방법이다.

"아직 나 대신 CEO 할 사람이 없다"를 느낌으로 두지 않고 **Founder Dependency Index**를 만든다.

DY에서 한 달 동안 중요한 의사결정이 100개 있었다면 — Edison이 직접 결정 37개, CEO 후보가 결정 42개,
조직/규정이 자동 결정 21개 → Founder Dependency = 37%.

목표는 12~18개월 동안 **37% → 25% → 15% → <10%**로 떨어뜨리는 것. 그러면 CEO 승계도 명확해진다.

### CEO Card

각 CEO를 클릭하면 매출만 보지 말고 이런 걸 본다.

```
CEO -- JOHN KIM
-----------------------------

Business Performance      87
Capital Discipline        91
People / Culture          83
Forecast Accuracy         94
Chairman Dependency       12%
Integrity / Trust         5/5

Autonomy Level            L4

Last Chairman Contact     18 days ago

Capital Requested         W1.2B
Capital Returned          W3.8B

Major Decisions
- Vietnam pricing restructuring
- New sales director
- Production automation
```

**Last Chairman Contact가 의외로 중요한 KPI가 될 수 있다.** 성과는 좋은데 나와 연락하는 횟수가 계속
줄어든다면 좋은 신호다. 반대로 매출은 잘 나오는데 매일 전화한다면 아직 독립 CEO가 아니다.

### Autonomy Level

이건 게임처럼 보이지만 실제 조직관리에는 상당히 유용할 것이다.

| Level | CEO 권한 |
|---|---|
| L1 | 중요한 결정 대부분 Chairman 승인 |
| L2 | 운영 독립 / 주요 의사결정 승인 |
| L3 | P&L 완전 책임 / 일정 금액 이하 투자 독립 |
| L4 | 전략·인사·운영 완전 독립 / 대형 투자만 승인 |
| L5 | Berkshire CEO — Chairman은 자본·CEO·방향만 관여 |

목표는 CEO들을 L5로 올리는 것. 이걸 회사 숫자보다 중요한 Group KPI로 만든다.

```
GROUP CEO AUTONOMY

L5   7 CEOs
L4   5 CEOs
L3   3 CEOs
L2   2 CEOs
L1   1 CEO

18 Companies
Average Founder Dependency: 8.7%
```

회사가 50개까지 늘어나도 재미있는 현상이 생긴다 — **회사 수가 증가하는데 Chairman 업무량은 거의
증가하지 않는 것이 Chairman OS의 성공 KPI가 된다.**

### Capital Market

각 CEO가 Chairman에게 투자 요청을 보낸다.

```
DY CEO:          베트남 2호 Mixer -- 20억   예상 ROIC 21%, Payback 4.1년
VANA CEO:        미국 500 locations -- 35억  예상 IRR 32%, Payback 2.8년
THE DEOL CEO:    미국 Launch -- 15억         예상 IRR 26%
Acquisition CEO: 경쟁사 인수 -- 50억          예상 IRR 19%
```

Chairman OS가 동일한 기준으로 normalize해서 나란히 보여준다.

**중요한 건 AI가 "VANA에 투자하세요"라고 결정하는 게 아니다.** AI는 가정을 검증하고, 숫자를 동일 기준으로
바꾸고, 과거 CEO 예측 정확도까지 붙여주는 역할을 한다.

예: CEO A는 지난 8건의 투자안에서 예상 EBITDA를 평균 6% 오차로 맞춤. CEO B는 지난 5건에서 평균 31% 과대추정.
이 데이터가 몇 년 쌓이면 정말 강력해진다 — 사업뿐 아니라 **CEO의 판단력 자체가 데이터가 되는 것**이다.

### 결국 이것만 있으면 된다

**COMPANIES → CEOs → CAPITAL → ATTENTION → SUCCESSION**

ERP / MES / R&D / Sales / CRM은 전부 그 밑에 깔리는 데이터 인프라다.

이 구조에서 특히 **SUCCESSION을 독립 메뉴**로 만든다. DY를 첫 번째 실험 대상으로 삼아 "Edison 없이 DY가
돌아가는 정도"를 매달 측정한다. 그게 90%를 넘어가는 순간 DY에서 빠져나오는 것이고, 그때부터 Chairman OS는
단순한 사내 프로그램이 아니라 5개 → 10개 → 50개 회사를 소유하기 위한 **operating architecture**가 된다.

---

## 원문 — PROJECT: CHAIRMAN OS / VERSION: Chairman Architecture v1.0

```text
========================================================
0. CORE PHILOSOPHY
========================================================

Chairman OS는 ERP가 아니다.

여러 회사를 소유한 Group Chairman이
수십 명의 CEO를 통해 회사를 운영하기 위한
"Capital Allocation + CEO Control + Exception Management OS"다.

모든 데이터를 Chairman에게 보여주는 것이 목적이 아니다.

ERP / MES / CRM / R&D / Sales / Finance 등의 데이터를 수집한 뒤,
Chairman이 실제로 개입해야 하는 정보만 압축해서 보여준다.


CORE PRINCIPLE:

Companies can scale.
CEOs can scale.
Data can scale.

Chairman's attention must NOT scale.


Chairman이 직접 책임지는 것은 기본적으로 3가지다.

1. PEOPLE
   - 누가 CEO인가?
   - 계속 맡길 것인가?
   - 후계자는 있는가?

2. CAPITAL
   - 어디에서 현금이 발생하는가?
   - 어디에 얼마를 재배치할 것인가?

3. DIRECTION
   - 이 회사가 어디로 가야 하는가?
   - 계속 보유 / 확장 / 축소 / 매각 / 인수할 것인가?


========================================================
1. ORGANIZATIONAL HIERARCHY
========================================================

CHAIRMAN
- Group Executive Office
- Industrial Group
   - DY Industrial CEO
   - Company CEO
   - Company CEO
- Consumer Group
   - THE DEOL CEO
   - Company CEO
- AI / Technology Group
   - VANA CEO
   - Company CEO
- Future / Robotics Group
   - HOUSE OF FUTURE CEO
   - Company CEO
- Investments / Acquisitions
   - Portfolio Company CEO
   - Portfolio Company CEO


초기에는 CEO가 Chairman에게 직접 보고할 수 있다.

CEO 수가 증가하면:

Chairman -> Sector President -> CEO -> Executives -> Organization

형태로 확장 가능해야 한다.


========================================================
2. INFORMATION HIERARCHY
========================================================

Raw Data
-> ERP / MES / CRM / R&D / Sales
-> Company OS
-> CEO Dashboard
-> Chairman OS
-> Chairman Decision


100,000 raw data points
-> 1,000 operational signals
-> 100 CEO-level signals
-> 10 Chairman signals
-> 1~3 Chairman decisions


IMPORTANT:

Chairman OS는
"Information Display System"이 아니라
"Information Compression System"
이어야 한다.


========================================================
3. MAIN NAVIGATION
========================================================

01 HOME
02 ATTENTION
03 COMPANIES
04 CEOs
05 CAPITAL
06 SUCCESSION
07 DIRECTION
08 GROUP
09 REPORTS
10 DATA / INTEGRATIONS


========================================================
4. HOME -- CHAIRMAN COCKPIT
========================================================

첫 화면에서 가장 중요한 것은
그래프가 아니라 Chairman Attention이다.


HEADER KPIs:

GROUP VALUE
GROUP REVENUE
GROUP EBITDA
GROUP FCF
AVAILABLE CASH
TOTAL DEBT
CAPITAL DEPLOYED
NUMBER OF COMPANIES
NUMBER OF CEOs


----------------------------------------
CHAIRMAN ATTENTION
----------------------------------------

시스템이 자동으로 Chairman 개입이 필요한 것만 표시.

예:

RED
DY INDUSTRIAL
Margin -3.2%
Reason: Raw material increase
CEO decision required

YELLOW
VANA
US Expansion
Capital Request: W3.5B

YELLOW
THE DEOL
Launch D-63
Key executive hiring delayed


GREEN 회사는 기본적으로 Chairman Attention에서 숨긴다.


화면 하단:

"47 companies operating normally.
No Chairman action required."


========================================================
5. COMPANY PORTFOLIO
========================================================

TABLE:

Company / Sector / CEO / Revenue / Growth / EBITDA / EBITDA Margin /
FCF / ROIC / Cash / Debt / Founder Dependency / CEO Autonomy /
Capital Requested / Status


STATUS:

GREEN   Normal / no intervention
YELLOW  Monitor
RED     Chairman decision required


Company 클릭 -> Company Detail.


========================================================
6. COMPANY DETAIL
========================================================

TOP:

Company Name / CEO / Sector / Ownership % / Enterprise Value /
Revenue / EBITDA / FCF / ROIC / Cash / Debt / Status


SECTIONS:

Financial / Operations / Sales / Customers / R&D / People /
Capital / CEO / Succession / Risks / Chairman Decisions


Chairman에게 기본적으로 운영 raw data는 숨긴다.

"View Operational Detail" 을 눌렀을 때 ERP/MES까지 drill-down.


========================================================
7. FOUNDER DEPENDENCY INDEX
========================================================

매우 중요한 KPI.


FORMULA:

Founder Dependency Index =
Chairman-involved major decisions / Total major decisions x 100


예:

Major Decisions = 100
Chairman decided = 37
CEO decided = 42
System / Policy = 21

Founder Dependency = 37%


TREND:

JUL 41%
AUG 34%
SEP 27%

TARGET < 10%


DEPENDENCY CATEGORY:

Pricing / Customers / R&D / Production / Hiring /
Investment / Overseas / Strategy / Finance


각 영역별 dependency를 표시한다.

예:

Pricing              72%
Top Customers        83%
R&D                  41%
Production           12%
Hiring                8%
Finance              22%
Vietnam Strategy     67%


이를 통해
"회사가 Chairman의 어느 부분에 의존하는가"
를 볼 수 있어야 한다.


========================================================
8. CEO SYSTEM
========================================================

CEO는 Chairman OS의 핵심 Asset으로 관리한다.


CEO CARD:

Name / Company / Position / Tenure

Business Performance / Capital Discipline / Forecast Accuracy /
People / Culture / Execution / Integrity / Trust / Chairman Dependency

Autonomy Level

Last Chairman Contact
Chairman Contacts / Month

Capital Requested / Capital Approved / Capital Returned

Major Decisions

Successor Readiness


IMPORTANT:

CEO 평가를 단순 점수 하나로 합치지 않는다.
여러 dimension을 독립적으로 보여준다.


========================================================
9. CEO AUTONOMY LEVEL
========================================================

L1  Chairman approval required for major decisions.

L2  Independent daily operations.
    Major strategic decisions require approval.

L3  Full P&L responsibility.
    Investment below threshold independently approved.

L4  Independent strategy / people / operations.
    Chairman approves only major capital decisions.

L5  BERKSHIRE MODE
    CEO independently operates company.
    Chairman focuses on:
      Capital
      CEO appointment/removal
      Major direction
      Exceptional risk


GROUP KPI:

L5 CEOs: 7
L4 CEOs: 5
L3 CEOs: 3
L2 CEOs: 2
L1 CEOs: 1

AVERAGE AUTONOMY: L4.1


========================================================
10. CEO CONTACT / DEPENDENCY TRACKING
========================================================

Track:

CEO -> Chairman calls
Meetings
Messages
Approval Requests
Emergency escalations


Example:

CEO A
Jul     21 contacts
Aug     14
Sep      7

Business performance remains GREEN.

Interpretation: CEO independence increasing.


WARNING:

High performance + low dependency   = desirable
High performance + high dependency  = succession incomplete
Low performance + low communication = possible hidden risk


========================================================
11. SUCCESSION SYSTEM
========================================================

Every company should have:

Current CEO
CEO Candidate
Emergency Successor
Long-term Successor


SUCCESSION READINESS: 0-100%


Example:

DY INDUSTRIAL
Current CEO: Edison
Candidate:   CEO Candidate A
Readiness:   38%


TRANSFER MATRIX:

Production            COMPLETE
Routine Hiring        COMPLETE
Domestic Sales        COMPLETE
Pricing               IN PROGRESS
Key Accounts          NOT TRANSFERRED
Capital Allocation    NOT TRANSFERRED
Vietnam Strategy      NOT TRANSFERRED


90 DAY / 180 DAY / 365 DAY transition roadmap.


========================================================
12. "CHAIRMAN ABSENCE TEST"
========================================================

각 회사가 Chairman 없이 얼마나 버틸 수 있는지 측정.

QUESTION:

"If Chairman becomes unreachable tomorrow,
can this company operate normally for 30 days?"

Track: 7 DAY / 30 DAY / 90 DAY / 365 DAY

Target:

Company reaches "365 DAY INDEPENDENT"
before CEO is considered true L5.


========================================================
13. CAPITAL ALLOCATION
========================================================

Capital은 그룹 전체에서 하나의 Pool로 본다.

CASH GENERATION:

Company A -> +W3B
Company B -> +W1B
Company C -> +W5B

-> GROUP CAPITAL POOL ->

Possible deployment:

Existing company / New factory / R&D / International expansion /
Acquisition / New venture / Financial investment / Debt repayment /
Cash reserve


========================================================
14. CAPITAL REQUEST SYSTEM
========================================================

CEO가 Chairman에게 Capital Request 제출.

REQUIRED INPUT:

Company / CEO
Request Amount / Purpose / Timeline
Expected Revenue / Expected EBITDA / Expected FCF
Expected ROIC / Expected IRR / Payback Period
Best Case / Base Case / Worst Case
Strategic Reason
Risks
What happens if rejected?


Example:

VANA US Expansion
Request:        W3.5B
Expected IRR:   32%
Payback:        2.8 years
Requested By:   CEO A


========================================================
15. CAPITAL MARKET
========================================================

모든 회사의 Capital Request를 동일한 기준으로 normalize.

TABLE:

Opportunity / CEO / Capital / Expected ROIC / Expected IRR /
Payback / Risk / Forecast Reliability / Strategic Importance


IMPORTANT:

AI는 투자 결정을 하지 않는다.

AI 역할:

Normalize assumptions
Detect inconsistencies
Compare opportunities
Run scenarios
Show historical accuracy
Identify risks

Final capital decision: CHAIRMAN


========================================================
16. CEO FORECAST ACCURACY
========================================================

매우 중요한 장기 데이터.

CEO가 Capital Request 시 예측한
Revenue / EBITDA / FCF / Timeline / ROI 를 실제 결과와 비교.


Example:

CEO A -- 8 Investments
Revenue Forecast Error:  6%
EBITDA Forecast Error:   8%
Schedule Error:         11%

CEO B -- 5 Investments
EBITDA Overestimation:  31%


이 데이터를 시간이 지나면서 CEO judgment history로 축적.


========================================================
17. DECISION LOG
========================================================

모든 중요한 의사결정 기록.

Decision:            Build Vietnam Plant No.2
Requested by:        DY CEO
Capital:             W2B
CEO Recommendation:  Proceed
Chairman Decision:   Approved
Expected ROIC:       21%
Expected Payback:    4.1 years

1 YEAR LATER:

Actual ROIC:             18.7%
Actual Payback Forecast: 4.5 years


이를 통해 CEO 판단 / Chairman 판단 / Capital 결과 를 장기적으로 학습.


========================================================
18. EXCEPTION MANAGEMENT ENGINE
========================================================

Chairman은 정상 상태를 관리하지 않는다. Exception만 관리한다.

TRIGGER EXAMPLES:

Revenue variance > threshold
EBITDA margin deterioration
Cash below threshold
Debt covenant issue
Major customer loss
Production disruption
Quality issue
CEO forecast miss
Large employee turnover
Capital project delay
Legal issue
Fraud signal
Cybersecurity issue


System:

Raw Data -> Rule Engine -> AI Analysis -> Severity -> Chairman Attention


========================================================
19. ATTENTION SCORE
========================================================

각 문제에 대해:

Financial Impact / Strategic Impact / Urgency / Probability /
CEO Ability to Resolve / Capital Requirement

등을 분석.

OUTPUT:

RED     Chairman decision
YELLOW  Chairman awareness
GREEN   CEO handles


주의:

AI가 CEO를 대신하지 않는다.
AI는 Chairman에게 "어디를 볼 것인가"를 알려준다.


========================================================
20. DIRECTION
========================================================

각 회사마다 Chairman Direction을 기록.

Example:

DY INDUSTRIAL

5 YEAR DIRECTION
Become global adhesive network.

Priorities:
1. Vietnam
2. Southeast Asia
3. Sticky Alliance
4. High margin specialty adhesives

DO NOT:
Commodity price competition
Low-margin expansion

CEO는 이 Direction 안에서 자유롭게 운영한다.


========================================================
21. CHAIRMAN LETTER
========================================================

각 회사마다 Chairman이 CEO에게 1페이지 Direction Letter를 작성할 수 있게 한다.

Fields:

Why we own this company
5-year objective
Capital philosophy
Things Chairman cares about
Things Chairman does NOT want to manage
Red lines
When to contact Chairman

이 문서가 CEO의 operating constitution 역할.


========================================================
22. GROUP MAP
========================================================

Visual Hierarchy:

CHAIRMAN
-> Industrial / Consumer / Technology / Future / Investments
-> Companies
-> CEOs

Company card size: Revenue / Enterprise Value 기반.
Color: GREEN / YELLOW / RED 상태 기반.


========================================================
23. CHAIRMAN PERSONAL DASHBOARD
========================================================

Chairman 자신의 병목도 측정.

THIS MONTH:

Companies             12
CEOs                  12
CEO Contacts          37
Approval Requests     18
Capital Decisions      4
Operational Decisions 11

TARGET: Operational Decisions -> 0


CHAIRMAN TIME:

Capital             31%
People              26%
Direction           22%
New Opportunities   16%
Operations           5%

Long-term Target: Operations < 5%


========================================================
24. CHAIRMAN SCALABILITY INDEX
========================================================

새로운 핵심 KPI.

Measure whether company count can increase
without proportional increase in Chairman workload.

2026   Companies: 4    Chairman Decisions/month: 61
2028   Companies: 12   Chairman Decisions/month: 47
2030   Companies: 30   Chairman Decisions/month: 52

GOOD:  Company up up,  Chairman workload flat
BAD:   Company up,     Chairman workload up


========================================================
25. DATA ARCHITECTURE
========================================================

DATA SOURCES:

ECOUNT ERP / MES / FutureSoft / CRM / R&D Database / Sales /
Accounting / HR / Excel / Manual Input / External APIs

FLOW:

Source -> Connector -> Data Warehouse -> Normalization Layer ->
Company Metrics -> Exception Engine -> AI Analysis -> Chairman OS

IMPORTANT:

Chairman OS DB는 source-of-truth ERP를 대체하지 않는다.
Chairman OS는 Management Intelligence Layer다.


========================================================
26. CORE DATABASE ENTITIES
========================================================

Group / Sector / Company / Person / CEO / CEOAssignment /
FinancialMetric / OperationalMetric / CapitalRequest /
CapitalAllocation / Investment / Decision / Exception /
ChairmanAttention / SuccessionPlan / SuccessorCandidate /
AutonomyAssessment / FounderDependency / Forecast / ActualResult /
ChairmanDirection / Risk / Integration / DataSource


========================================================
27. BASIC RELATIONSHIPS
========================================================

Group hasMany Companies
Company belongsTo Sector
Company hasOne CurrentCEO
Company hasMany FinancialMetrics
Company hasMany CapitalRequests
Company hasMany Decisions
Company hasMany Exceptions
Company hasOne SuccessionPlan

CEO canManage Company
CEO hasMany Forecasts
CEO hasMany Decisions
CEO has AutonomyLevel
CEO has ForecastAccuracy

CapitalRequest belongsTo Company, belongsTo CEO
CapitalRequest mayBecome CapitalAllocation

Decision belongsTo Company, belongsTo DecisionMaker
Decision has Forecast, has ActualResult


========================================================
28. ROLE PERMISSIONS
========================================================

CHAIRMAN
  Can see: Everything
  Default view: Compressed information

SECTOR PRESIDENT
  Can see: Assigned sector

CEO
  Can see: Own company
  Can submit: Capital Request / Strategy / Forecast / Escalation

EXECUTIVE
  Can see: Authorized department

EMPLOYEE
  Can see: Role-based operational information


========================================================
29. AI LAYER
========================================================

AI functions:

Daily summary
Exception detection
Financial anomaly detection
CEO forecast comparison
Capital normalization
Scenario simulation
Decision history search
Meeting summarization
Cross-company pattern detection


Example:

"Why is DY yellow?"

AI:

"DY EBITDA margin declined from X to Y.
72% of decline is associated with raw-material cost.
CEO has already initiated price adjustment.
No Chairman decision is currently required.

Monitor for 14 days."


Another:

"What needs my attention today?"

AI returns maximum: 3-5 high priority items.


========================================================
30. AI NIGHTLY PROCESS
========================================================

Every night:

1. Sync ERP
2. Sync MES
3. Sync CRM
4. Sync Finance
5. Sync HR
6. Calculate KPIs
7. Detect anomalies
8. Compare forecasts
9. Update Founder Dependency
10. Update CEO Autonomy
11. Update Capital Requests
12. Generate Chairman Attention
13. Generate Morning Brief


========================================================
31. MORNING BRIEF
========================================================

Example:

GOOD MORNING, CHAIRMAN.

47 companies operating.
44 require no attention.
3 items require review.

1. VANA
   W3.5B capital request
   US expansion
   Decision deadline: Sep 25

2. DY INDUSTRIAL
   EBITDA margin variance: -3.2%
   CEO handling: YES
   Chairman action: NONE

3. Company X
   CEO succession risk
   Emergency successor: NONE
   Chairman action: REQUIRED

GROUP CASH: W12.8B


========================================================
32. UI PHILOSOPHY
========================================================

Do NOT build traditional ERP UI.

Style:

Premium / Minimal / Calm / Institutional / Executive

Think:

Apple
Bloomberg
Private Family Office
Institutional Investment Dashboard

Avoid:

Too many graphs
Too many colors
ERP-like menus
Dense accounting screens
Operational clutter

Color should indicate exceptions, not decoration.


========================================================
33. DRILL-DOWN PRINCIPLE
========================================================

LEVEL 0   Chairman Attention
LEVEL 1   Company / CEO / Capital
LEVEL 2   Financial / Strategy / People
LEVEL 3   ERP / MES / CRM

Chairman normally stays: LEVEL 0-1.
Only exceptional situations require LEVEL 2-3.


========================================================
34. DY INDUSTRIAL -- FIRST PILOT
========================================================

DY를 Chairman OS의 첫 번째 CEO Succession 실험 회사로 사용.

Current CEO: Edison

GOAL: Transfer operational authority to future CEO.

Track:

Founder Dependency
CEO Autonomy
Chairman Contacts
Approval Requests
Operational Decisions
Key Customer Dependency
Pricing Dependency
R&D Dependency
Vietnam Dependency
Capital Dependency

TARGET:

Founder Dependency <10%
Operational Chairman Decisions <5%
CEO Autonomy L5
30-day absence PASS
90-day absence PASS
Eventually: 365-day absence PASS


========================================================
35. DY SUCCESSION SCREEN
========================================================

DY INDUSTRIAL
CEO TRANSITION

Founder Dependency  37%
Target              <10%

Transferred:
  Production
  Routine Hiring
  Domestic Sales

In Progress:
  Pricing
  R&D

Not Transferred:
  Top Customers
  Vietnam Strategy
  Capital Allocation

NEXT 90 DAYS:

Transfer pricing authority
Transfer Top 20 customer ownership
CEO candidate runs monthly P&L
CEO candidate submits first capital plan


========================================================
36. ULTIMATE GROUP KPI
========================================================

Chairman OS가 성공했다는 것은
Chairman이 더 많은 정보를 보는 것이 아니다.

SUCCESS =

Companies up
CEOs up
Revenue up
FCF up
Capital Opportunities up

WHILE

Chairman Operational Decisions down
Chairman Dependency down
Information Overload down


========================================================
37. ULTIMATE OBJECTIVE
========================================================

The system should make it possible for:

1 Chairman

to control capital and direction across
10 / 20 / 50+ independently operated companies

without becoming the operational bottleneck.


FINAL PRINCIPLE:

OWN MANY.
OPERATE FEW.
ALLOCATE CAPITAL.
SELECT PEOPLE.
SET DIRECTION.
MANAGE EXCEPTIONS.

Chairman OS exists to protect
the Chairman's most scarce asset:

ATTENTION.
========================================================
```

---

## 이 저장소가 이 문서를 어떻게 쓰는가 (컨트롤러 메모, 원문이 아니다)

- **Phase 7의 바인딩 권위는 이 문서다.** 회장이 따로 준 Phase 7 블록 지시(A~G)는 이 문서를
  `chairman-os`의 표·화면으로 옮기는 **실행 계획**이고, 둘이 어긋나면 이 문서가 이긴다.
- 원문의 이모지 신호등(🔴🟡🟢)·원화 기호(₩)·괘선 문자는 이 파일에서 글자로 옮겼다. 뜻은 같다.
  화면에서는 원문대로 쓴다.
- **§ 번호가 곧 추적 코드다.** 앞으로 커밋·DEFERRED·UAT에서 `CH-0xx` 대신 `§4 HOME`, `§7 Founder
  Dependency`처럼 이 문서의 절 번호를 병기한다(회장 지시).
- 이 문서가 말하는 ERP/MES 연결은 **버리지 않는다** — 기존 화면(이니셔티브·재무·업무·문서·캘린더·
  프로세스차트)은 삭제하지 않고 §33의 LEVEL 2~3으로 내려간다.
