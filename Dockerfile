# Runtime image for integration-service.
#
# Three stages so the image that ships carries neither the TypeScript
# compiler nor the test dependencies: only the compiled dist/ and the
# packages it actually needs at runtime.
#
# The database migrations are copied in as well. They are not run by this
# image — a container that migrates on boot races with every other replica
# of itself — but they travel with the code that expects them, so the
# deployment can run them from the same image it is about to start.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Production dependencies only, resolved separately so the build stage's
# devDependencies cannot leak into the final image.
FROM node:22-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS run
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5001

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY database/migrations ./database/migrations

# node:22-alpine ships an unprivileged `node` user; nothing here needs to
# write to the image, so it runs as that rather than as root.
USER node

EXPOSE 5001

# Checked by Docker itself, so a container whose process is alive but whose
# database connection is gone is reported unhealthy instead of silently
# failing requests.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
