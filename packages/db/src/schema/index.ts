// drizzle-kit 0.28.x의 CJS 로더가 "./terms.js"를 "./terms.ts"로 해석하지 못해
// "Cannot find module './terms.js'" 오류가 난다. 그래서 확장자를 일부러 생략한다.
// (packages/db/src/index.ts는 drizzle-kit이 읽지 않으므로 그쪽은 .js를 그대로 쓴다.)
export * from "./terms";
export * from "./auth";
export * from "./revisions";
