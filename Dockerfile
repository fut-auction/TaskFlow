# Multi-stage production container: build tools never ship with the runtime image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S taskflow && adduser -S taskflow -G taskflow
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=taskflow:taskflow /app/dist ./dist
COPY --chown=taskflow:taskflow server ./server
USER taskflow
EXPOSE 8080
CMD ["node", "server/index.mjs"]
