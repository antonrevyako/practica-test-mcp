FROM cloudflare/cloudflared:2026.10.4 AS cloudflared

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# This image only includes the tunnel gateway. UI/backend-only changes leave it unchanged.
FROM node:24-bookworm-slim AS tunnel-runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/practica.sqlite TUNNEL_CONTROL_PORT=4300 TUNNEL_BIND_HOST=0.0.0.0 TUNNEL_APP_HOST=practica
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN node -e "require('node:fs').writeFileSync('package.json', JSON.stringify({type:'module'}))"
COPY --from=build --chown=node:node /app/dist/tunnel/daemon.js /app/dist/tunnel/runtime-paths.js /app/dist/tunnel/cloudflare-tunnel.js /app/dist/tunnel/cloudflared.js /app/dist/tunnel/gateway.js ./dist/tunnel/
COPY --from=build --chown=node:node /app/dist/server/environment.js /app/dist/server/identity.js ./dist/server/
COPY --from=build --chown=node:node /app/scripts/tunnel.mjs ./scripts/tunnel.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
HEALTHCHECK --interval=2s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:4300/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/tunnel/daemon.js"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/practica.sqlite
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
