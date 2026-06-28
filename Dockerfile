# KnowPilot — 单容器运行 Web + Server（SQLite 持久化卷）
FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @knowpilot/server db:generate
ENV DATABASE_URL="file:./build.db"
RUN pnpm --filter @knowpilot/server db:push
RUN pnpm db:sync
RUN pnpm --filter @knowpilot/web build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/tsconfig.base.json ./
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/content ./content
COPY --from=build /app/scripts ./scripts

EXPOSE 3000 3010

CMD ["sh", "-c", "pnpm --filter @knowpilot/server exec prisma db push --accept-data-loss && pnpm db:sync && (pnpm --filter @knowpilot/server start &) && pnpm --filter @knowpilot/web start -p 3000"]
