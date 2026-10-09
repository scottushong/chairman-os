# BOM 암호 키 만들기 (0063) — 회장이 따라 하는 순서

**무엇:** 원가 엔진의 비공개 BOM(제품별 원료 · 비율)은 0063부터 암호문으로만 저장된다. 그 암호 키 하나를 Supabase Vault에
`cost_bom_key`라는 이름으로 만든다. **키는 DB 안에서 무작위로 만들어지고 화면에 글자로 나오지 않는다** — 아무도 키를 보거나 복사하지 않는다.

**순서:** staging 먼저 → staging에 0061~0065 반영 · 시험 → production은 운영 반영 때(맨 아래 «production»).
키를 만드는 것은 마이그레이션보다 **먼저** 해도 되고 나중에 해도 된다. 다만 키가 없는 동안에는 BOM 저장과 원가 계산이
«BOM 암호 키가 없습니다» 오류로 멈춘다(조용히 0이 나오지 않는다).

---

## 1. staging (itpenmxyracfhyormcep · Seoul)

1. 브라우저에서 https://supabase.com/dashboard/project/itpenmxyracfhyormcep 를 연다.
2. 왼쪽 메뉴 **SQL Editor** → 위 **+ New query**.
3. 먼저 확장 둘이 켜져 있는지 본다. 아래를 붙여 넣고 **Run**:

   ```sql
   select extname, extnamespace::regnamespace as schema from pg_extension where extname in ('pgcrypto', 'supabase_vault');
   ```

   두 줄(`pgcrypto | extensions`, `supabase_vault | vault`)이 나오면 다음으로. 하나라도 없으면 왼쪽 **Database → Extensions**에서
   그 이름을 검색해 켠다(무료).
4. 같은 창을 지우고 아래 **한 줄**을 붙여 넣고 **Run** (키를 DB가 만든다 — 글자로 적힌 키가 없다):

   ```sql
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'cost_bom_key', 'chairman-os 0063 BOM 암호 키 — 지우거나 바꾸지 말 것');
   ```

   결과로 긴 id(uuid) 하나가 나오면 된다. 이미 있다는 오류(`duplicate key`)가 나오면 이미 만든 것이다 — 다시 만들지 않는다.
5. 확인(키 값은 보지 않는다 — 이름과 시각만):

   ```sql
   select name, created_at from vault.secrets where name = 'cost_bom_key';
   ```

   한 줄이 나오면 끝.
6. 0063을 staging에 반영한 뒤 앱에서 확인: `대표` 계정으로 `/costs/biz_dy/bom` 을 열면 머리에 **«암호 키: 준비됨»** 이 보인다.

## 2. 하지 말 것

- `vault.decrypted_secrets` 를 열어 키 값을 보지 않는다. 키를 메모장 · 메일 · 메신저 · 저장소에 옮기지 않는다.
- `cost_bom_key` 를 지우거나 `vault.update_secret` 으로 바꾸지 않는다. 바꾸면 그때까지 저장한 BOM을 **읽을 수 없다**
  («BOM을 읽을 수 없습니다 — 키가 바뀌었거나 저장된 값이 깨졌습니다»). 그때는 R2(원본)에서 BOM을 다시 넣는다.
- `show log_statement;` 가 `all` 이면 SQL 문장이 로그에 남는다(기본은 `none`). 바꾸지 않는다.

## 3. 진짜 BOM 받기 (나중)

0063은 BOM을 암호문으로 받지만, **진짜 BOM 입력은 기본으로 잠겨 있다**(회장 결정 — 암호화가 운영에서 확인된 뒤).
production에서 위 키 확인과 0063 반영 · 시험이 끝난 뒤, 대표 화면 `/costs/<회사>/bom` 의 **«진짜 BOM 받기»** 스위치로 켠다.
그 전까지는 «가짜(시험)» 판만 저장된다.

## 4. production (nndvspgnljivkvihxlzj · Tokyo) — 운영 반영 때

staging 시험(`docs/onboarding/staging-tests/0061_0065_staging_test.sql`)이 PASS인 뒤:

1. https://supabase.com/dashboard/project/nndvspgnljivkvihxlzj → **SQL Editor** → **+ New query**.
2. 위 1-3(확장 확인) → 1-4(키 한 줄) → 1-5(확인)를 그대로.
3. 그다음 `release-production.sh` 로 0061~0065 반영(release-order 문서 순서).

## 5. 무엇을 막고 무엇을 못 막나

| 막는 것 | 못 막는 것 |
|---|---|
| DB 백업 · 덤프 · 표 내보내기 · 실수로 연 grant · SQL Editor에서 표만 열어 보기 · 감사 줄 · 오류 문장 · pg_stats | Supabase 프로젝트 소유자(postgres 권한으로 Vault와 해독 함수를 직접 부를 수 있다) |

해독은 `cost_secret.bom_lines_of` 한 함수에서만 하고, 그 함수는 앱 사용자가 부를 수 없다(원가 계산 · 대표 BOM 화면이 안에서 부른다).
