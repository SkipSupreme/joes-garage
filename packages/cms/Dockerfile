FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS build
WORKDIR /app
# Copy monorepo root files needed for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cms/package.json ./packages/cms/
# Install deps (same stage preserves pnpm symlinks)
RUN pnpm install --frozen-lockfile --filter cms
# Copy source and build
COPY packages/cms ./packages/cms
WORKDIR /app/packages/cms
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/cms/.next/standalone ./
COPY --from=build /app/packages/cms/.next/static ./packages/cms/.next/static
COPY --from=build /app/packages/cms/public ./packages/cms/public

EXPOSE 3000
CMD ["node", "packages/cms/server.js"]
