FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY apps/api/package*.json ./apps/api/
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install && npm install --prefix apps/api --no-audit --no-fund

# Copy source code
COPY apps/api ./apps/api
COPY infra/postgres/migrations /infra/postgres/migrations

ENV NODE_ENV=production
ENV DATABASE_MIGRATIONS_DIR=/infra/postgres/migrations
EXPOSE 4000
CMD ["node", "apps/api/node_modules/.bin/tsx", "apps/api/src/server.ts"]
