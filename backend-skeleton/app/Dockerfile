FROM node:22-alpine
WORKDIR /srv
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production
EXPOSE 8000
USER node
CMD ["node", "src/server.js"]
