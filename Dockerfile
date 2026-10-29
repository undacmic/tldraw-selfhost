FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_TLDRAW_LICENSE_KEY=""
ENV VITE_TLDRAW_LICENSE_KEY=$VITE_TLDRAW_LICENSE_KEY
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/undacmic/tldraw-selfhost"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5858 DATA_DIR=/data/rooms
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /data/rooms && chown -R node:node /data
USER node
EXPOSE 5858
CMD ["node", "dist/server/index.js"]
