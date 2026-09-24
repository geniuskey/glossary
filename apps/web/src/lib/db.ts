import { createDb, type Db } from "@glossary/db";

// 모듈 변수만으로 캐시하면 next dev가 이 모듈을 다시 올릴 때마다 풀(최대 10연결)이
// 새로 생기고, 옛 풀은 닫히지 않은 채 남는다. 편집이 쌓이면 Postgres가
// "too many clients"로 모든 쿼리를 거부한다. 프로세스 단위로 하나만 둔다.
const globalForDb = globalThis as typeof globalThis & { __glossaryDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__glossaryDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__glossaryDb = createDb(url);
  }
  return globalForDb.__glossaryDb;
}
