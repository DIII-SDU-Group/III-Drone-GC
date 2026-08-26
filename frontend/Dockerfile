FROM node:22.20.0-alpine3.22@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af AS build
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

WORKDIR /app

ARG VITE_GC_PROXY_URL=http://localhost:8780
ENV VITE_GC_PROXY_URL=${VITE_GC_PROXY_URL}

COPY src/III-Drone-GC/frontend/package*.json ./
RUN npm ci

COPY src/III-Drone-GC/frontend/ ./
RUN npm run build

FROM nginx:1.27.5-alpine3.21@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
