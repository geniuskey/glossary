const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error("DATABASE_URL_TEST가 필요합니다. 테스트는 개발 DB에 붙지 않습니다.");
}
process.env.DATABASE_URL = testUrl;
