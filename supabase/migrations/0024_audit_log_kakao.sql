-- ---------------------------------------------------------------------
-- 0024. audit_log_insert 정책에 카카오 두 액션을 더한다 (전방 수정)
--
-- **무슨 일이 있었나.** 0023이 audit_action에 kakao_sent / kakao_failed를 더했지만,
-- 0015가 세운 audit_log_insert 정책의 AIAgent 분기는 여전히
-- `action::text = 'night_job_completed'`만 통과시킨다. 그래서 07:00 cron이 send-brief.ts의
-- done()에서 감사 행을 넣으려 할 때마다 42501로 막힌다. done()은 이 실패를 던지지 않고
-- console.error로 삼킨다(카톡이 안 갔다고 브리핑 Job까지 Failed가 되면 안 되므로) — Job은
-- 성공으로 보고되고, 카톡이 왜 안 왔는지(또는 갔는지) 답할 감사 행이 하나도 남지 않는다.
-- 여섯 cron 종료 경로(성공 발송 하나, skipped/error 다섯) 전부가 이 경로를 탄다.
--
-- **왜 여덟 번의 리뷰에서 안 걸렸나.** Chairman이 직접 누르는 테스트 발송 경로는
-- auth_role() = 'Chairman'이라 정책의 else true 분기로 빠져 늘 통과한다 — 손으로 확인하면
-- 항상 성공해 보인다. scripts/check-migrations.ts의 카카오 검사도 0023이 준 다섯 RPC를
-- owner(security definer) 권한으로만 돌렸을 뿐, AIAgent 세션으로 실제 애플리케이션 표(audit_log)에
-- INSERT를 던지는 검사는 한 번도 없었다 — RLS가 막는 자리를 아무도 밟지 않았다.
--
-- **왜 전방 수정인가.** 0023이 staging에 이미 적용됐을 수 있다(리뷰 시점 기준 미확인).
-- 적용됐다면 0023을 고쳐 다시 적용한 척하는 것은 0022가 이미 겪고 기록한 실패다
-- (적용된 마이그레이션을 몰래 바꾸면 체크섬이 드리프트되어 staging이 깨진다, OPERATIONS 9).
-- 아직 적용 전이었다면 이 파일은 그저 한 번 더 같은 결과를 내고 끝난다 — 새 파일 하나가
-- 그 확인 비용보다 싸다.
--
-- action::text로 비교하는 것은 0022/0023과 같은 이유다(55P04) — 같은 트랜잭션에서 갓
-- 추가한 enum 리터럴은 쓸 수 없지만, 여기서는 0023이 이미 커밋한 값을 문자열로만 비교하므로
-- 애초에 걸리지 않는다. 그래도 이 저장소의 관례를 그대로 따른다.
-- ---------------------------------------------------------------------

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (
    is_active()
    and case
      when auth_role() = 'AIAgent'
        then action::text in ('night_job_completed', 'kakao_sent', 'kakao_failed') and actor_user_id = auth.uid()
      when is_integration()
        then action::text = 'ecount_sync_completed' and actor_user_id = auth.uid()
      else true
    end
  );
