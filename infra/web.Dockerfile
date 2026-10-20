FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
ARG VITE_DEMO=false
# 演示密码不得作为构建参数进入公开 JS 包；生产构建只填入演示账号名
ENV VITE_DEMO=$VITE_DEMO
RUN npm run build -w web
FROM nginx:1.28-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
