FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production PORT=3001 KNOWLEDGE_DIR=/app/knowledge/runtime DATA_DIR=/app/data PROVIDER=openai CHAT_ENABLED=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY knowledge/runtime ./knowledge/runtime
COPY scripts/usage.mjs ./scripts/usage.mjs
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data && chmod -R a-w /app/knowledge
VOLUME ["/app/data"]
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
