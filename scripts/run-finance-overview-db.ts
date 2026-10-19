/** 0085 DB 검사만 따로(빠르게) — 전체는 npm run check:migrations. */
import { financeOverviewDb } from './check-finance-overview-db'

financeOverviewDb()
  .then((m) => console.log(`PASS: ${m}`))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
