FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Chromium for Puppeteer (waiver PDF generation)
RUN apk add --no-cache chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true

FROM base AS deps
WORKDIR /app
# Copy monorepo root files needed for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
# Install only the api package dependencies
RUN pnpm install --frozen-lockfile --filter api

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY packages/api ./packages/api
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
WORKDIR /app/packages/api
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/api/dist ./dist
COPY --from=build /app/packages/api/node_modules ./node_modules
COPY --from=build /app/packages/api/package.json ./
COPY packages/api/src/templates ./src/templates

EXPOSE 3001
CMD ["node", "dist/server.js"]
