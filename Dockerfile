FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci
FROM deps AS build
COPY tsconfig.json eslint.config.js drizzle.config.ts ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
RUN test -f /app/src/db/migrations/meta/_journal.json
EXPOSE 4000
CMD ["npm","start"]
