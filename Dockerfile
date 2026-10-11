FROM node:20-slim

WORKDIR /app

# Install tini for clean PID 1 signal forwarding
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 8080) + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
