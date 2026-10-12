FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY api ./api
COPY database ./database
CMD ["npm", "test"]
