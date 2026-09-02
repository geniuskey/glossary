# syntax=docker/dockerfile:1
#
# 사내망 온프레미스 배포용 이미지. next.config.ts에 `output: "standalone"`과
# 워크스페이스 루트로 올린 `outputFileTracingRoot`가 이미 설정돼 있어서,
# `.next/standalone` 안에 서버와 추적된 node_modules가 함께 들어간다.
#
# 스테이지는 셋이다:
#   runner   — 실서비스가 쓰는 최소 이미지. devDependencies가 없다.
#   migrator — drizzle-kit(devDependency)이 필요하므로 전체 의존성을 가진 별도
#              이미지. 마이그레이션과 관리자 계정 시딩을 여기서 돌린다.
# runner에 devDependencies를 넣지 않는 대신 migrator를 따로 두는 선택이다 —
# 운영 이미지에 빌드 도구를 남기지 않으려는 것.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- 의존성 ----
FROM base AS deps
# .npmrc를 빠뜨리면 안 된다 — strict-peer-dependencies=false가 여기 있고,
# 없으면 컨테이너 안의 install이 호스트와 다른 규칙으로 돌아 실패할 수 있다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile

# ---- 빌드 ----
FROM deps AS builder
ARG APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
COPY . .
RUN pnpm turbo run build --filter=@grossary/web

# ---- 운영 런타임 ----
FROM base AS runner
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="Grossary" \
      org.opencontainers.image.description="Self-hosted collaborative glossary for organization-specific terminology, optimized for Korean and English." \
      org.opencontainers.image.source="https://github.com/geniuskey/grossary" \
      org.opencontainers.image.licenses="Apache-2.0"
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone은 outputFileTracingRoot(워크스페이스 루트) 기준으로 트리를 만든다.
# 따라서 서버 진입점은 apps/web/server.js이고 node_modules는 그 위에 놓인다.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# apps/web/public은 아직 없다. 없는 경로를 COPY하면 빌드가 실패하므로 줄을 두지
# 않는다. 정적 파일을 추가하게 되면 그때 이 줄을 살려라:
#   COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]

# ---- 마이그레이션 / 시딩 ----
# drizzle-kit도 tsx도 devDependency라 runner에는 없다. 이 스테이지가 그 둘을 갖는다.
FROM builder AS migrator
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="Grossary Database Migrator" \
      org.opencontainers.image.description="Database migration companion for the matching Grossary application image." \
      org.opencontainers.image.source="https://github.com/geniuskey/grossary" \
      org.opencontainers.image.licenses="Apache-2.0"
CMD ["pnpm", "--filter", "@grossary/db", "db:migrate"]

# Docker Hub에 `docker build -t ... .`로 올릴 기본 산출물은 반드시 웹 앱이어야
# 한다. migrator가 마지막 단계면 target을 생략한 이미지가 마이그레이션 명령만
# 실행하고 종료하므로, runner를 최종 기본 단계로 다시 가리킨다.
FROM runner AS app
