FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
ARG VITE_DEMO=false
ARG VITE_DEMO_PASSWORD
ENV VITE_DEMO=$VITE_DEMO VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD
RUN npm run build -w web
FROM nginx:1.28-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
