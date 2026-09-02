FROM node:22-alpine

WORKDIR /app
COPY apps/api/package*.json ./apps/api/
RUN npm install --prefix apps/api --no-audit --no-fund
COPY apps/api ./apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start"]
