# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install deps (npm install: lockfile may lag package.json after new deps; use npm ci once lock is synced)
COPY package*.json ./
RUN npm install --no-fund --no-audit

# Build app (NEXT_PUBLIC_* inlined at build time)
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Copy standalone output and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "server.js"]

# FROM node:20-alpine AS runner
# WORKDIR /app

# ENV NODE_ENV=production
# ENV HOSTNAME=0.0.0.0

# # Copy standalone output and static assets
# COPY --from=builder /app/.next/standalone ./
# COPY --from=builder /app/.next/static ./.next/static
# COPY --from=builder /app/public ./public

# EXPOSE 8080

# CMD ["node", "server.js"]

