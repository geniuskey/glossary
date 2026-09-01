import { sql } from "drizzle-orm";
import { boolean, check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "editor"]);
export const ssoProtocolEnum = pgEnum("sso_protocol", ["oidc", "oauth2"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // R132: SSO로만 들어오는 사람은 이 앱에 비밀번호가 없다. 아무 값이나 채워
    // 넣는 대신 null로 둔다 — 로그인 라우트는 null을 DUMMY_PASSWORD_HASH로
    // 대체해 검증하는데, 그 더미는 어떤 비밀번호로도 일치할 수 없는 값이라
    // (해시부가 전부 0) SSO 계정이 비밀번호로 뚫리지 않으면서 응답 시간도
    // 같게 유지된다.
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").notNull().default("editor"),
    externalId: text("external_id"),
    // 마지막 SSO 로그인에서 IdP가 확인해 준 그룹/조직. 로그인할 때마다 최신
    // claim으로 동기화하며, 로컬 계정은 null로 두어 이메일로 표시한다.
    ssoGroups: text("sso_groups").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
    // R131: 로그인 화면에서 누구나 가입할 수 있게 되면서 "Kim@Example.com"과
    // "kim@example.com"이 서로 다른 계정이 될 수 있게 됐다. 원문 유니크 인덱스는
    // 대소문자가 다르면 통과시키고, 로그인은 lower(email)로 찾기 때문에 그 순간
    // 어느 계정으로 들어갈지가 행 순서에 달린다 — 에러 없이 조용히 갈리는 종류다.
    // 표시용 원문은 그대로 두고, 유일성만 소문자 기준으로 강제한다.
    emailLowerUnique: uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
    // R132: SSO 주체 식별자(sub)와 계정을 1:1로 묶는다. Postgres는 유니크 인덱스에서
    // NULL을 서로 다른 값으로 보므로 SSO를 쓰지 않는 계정(전부 NULL)은 제한받지 않는다.
    externalIdUnique: uniqueIndex("users_external_id_unique").on(t.externalId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ userIdx: index("sessions_user_idx").on(t.userId) }),
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({ prefixUnique: uniqueIndex("api_keys_prefix_unique").on(t.prefix) }),
);

/**
 * R132: SSO(OIDC) 연결 설정. 운영자가 화면에서 채우는 값이라 환경변수가 아니라
 * 테이블에 둔다 — 사내 IdP를 붙이는 사람과 컨테이너를 띄우는 사람이 다르고,
 * claim 이름은 몇 번 고쳐 봐야 맞는 값을 찾는 종류라 재배포 없이 바꿀 수 있어야 한다.
 *
 * 행은 언제나 하나다(id = 'default'). 두 벌이 생기면 "어느 설정으로 로그인했는가"가
 * 행 순서에 달리는데, 그건 에러 없이 조용히 갈리는 종류라 체크 제약으로 막는다.
 */
export const ssoConfig = pgTable(
  "sso_config",
  {
    id: text("id").primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
    buttonLabel: text("button_label").notNull().default("회사 계정으로 로그인"),
    protocol: ssoProtocolEnum("protocol").notNull().default("oidc"),

    issuer: text("issuer").notNull().default(""),
    jwksUri: text("jwks_uri").notNull().default(""),
    authorizationEndpoint: text("authorization_endpoint").notNull().default(""),
    tokenEndpoint: text("token_endpoint").notNull().default(""),
    userinfoEndpoint: text("userinfo_endpoint").notNull().default(""),
    clientId: text("client_id").notNull().default(""),
    clientSecret: text("client_secret").notNull().default(""),
    scopes: text("scopes").array().notNull().default(["openid", "profile", "email"]),
    tokenAuthMethod: text("token_auth_method").notNull().default("client_secret_post"),
    // 프록시 뒤에서 Host 헤더를 못 믿을 때 운영자가 직접 못 박는 값. 비우면
    // 요청에서 유추한다(redirect_uri는 인가 요청과 토큰 요청에서 정확히 같아야 한다).
    baseUrl: text("base_url").notNull().default(""),

    // 회사마다 같은 값을 다른 이름으로 준다(name / displayName / preferred_username).
    // 후보를 순서대로 적어 두면 처음으로 값이 있는 것을 쓴다.
    subjectClaims: text("subject_claims").array().notNull().default(["sub"]),
    emailClaims: text("email_claims").array().notNull().default(["email", "upn", "mail"]),
    nameClaims: text("name_claims")
      .array()
      .notNull()
      .default(["name", "displayName", "preferred_username", "given_name"]),
    groupClaims: text("group_claims").array().notNull().default(["groups", "roles"]),

    allowedGroups: text("allowed_groups").array().notNull().default([]),
    adminGroups: text("admin_groups").array().notNull().default([]),
    autoCreate: boolean("auto_create").notNull().default(true),

    // IdP가 실제로 무엇을 보내는지 운영자가 볼 수 있게 마지막 로그인의 claim
    // "이름"만 남긴다. 값은 남기지 않는다 — 이름 목록만으로 매핑을 고칠 수 있고,
    // 값까지 남기면 사번·전화번호 같은 것이 설정 테이블에 쌓인다.
    lastClaimKeys: text("last_claim_keys").array().notNull().default([]),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({ singleRow: check("sso_config_single_row", sql`${t.id} = 'default'`) }),
);
