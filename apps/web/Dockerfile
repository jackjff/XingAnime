FROM node:22-alpine AS dependencies
WORKDIR /app
COPY apps/web/package*.json ./apps/web/
RUN npm install --prefix apps/web --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run --prefix apps/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web ./apps/web
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["npm", "run", "start"]
