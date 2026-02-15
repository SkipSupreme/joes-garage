FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
# Copy monorepo root files needed for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cms/package.json ./packages/cms/
# Install only the cms package dependencies
RUN pnpm install --frozen-lockfile --filter cms

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/cms/node_modules ./packages/cms/node_modules
COPY packages/cms ./packages/cms
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
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
