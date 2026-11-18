FROM node:22-alpine
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
# key directories owned by the unprivileged user (named volumes copy this ownership on first use)
RUN mkdir -p /auth-keys /public-key && chown node:node /auth-keys /public-key && chmod 700 /auth-keys
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
