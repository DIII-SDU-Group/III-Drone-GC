FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_GC_PROXY_URL=http://localhost:8780
ENV VITE_GC_PROXY_URL=${VITE_GC_PROXY_URL}

COPY src/III-Drone-GC/frontend/package*.json ./
RUN npm ci

COPY src/III-Drone-GC/frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
