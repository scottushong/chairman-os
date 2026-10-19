/** 0087 DB 검사만 따로 — 전체는 npm run check:migrations. */
import { approvalsDb } from './check-approvals-db'

approvalsDb()
  .then((m) => console.log(`PASS: ${m}`))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
