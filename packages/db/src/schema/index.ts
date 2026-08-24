// drizzle-kit 0.28.x의 CJS 로더가 "./terms.js"를 "./terms.ts"로 해석하지 못해
// "Cannot find module './terms.js'" 오류가 난다. 그래서 확장자를 일부러 생략한다.
// Next의 Turbopack도 같은 매핑을 못 하므로 이 패키지 전체가 확장자를 생략한다.
export * from "./terms";
export * from "./auth";
export * from "./revisions";
