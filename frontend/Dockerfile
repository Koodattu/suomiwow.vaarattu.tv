# syntax=docker/dockerfile:1.7

FROM node:24.22.1-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:24.22.1-alpine AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules

COPY . .
RUN npm run build

FROM node:24.22.1-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
