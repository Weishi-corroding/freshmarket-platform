FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY api ./api
COPY database ./database
# api/test/search-highlight.test.ts 复用前端 web/src/search-highlight.ts
COPY web ./web
CMD ["npm", "test"]
