FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY api ./api
COPY database ./database
RUN npm run build -w api
RUN npm prune --omit=dev
FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/database ./database
USER node
EXPOSE 3001
CMD ["node", "api/dist/server.js"]
