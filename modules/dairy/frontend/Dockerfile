# Build-Context ist das MODUL-ROOT (../ von hier, siehe docker-compose.yml
# `context: .` + `dockerfile: frontend/Dockerfile`), NICHT frontend/ allein —
# das Frontend importiert schema/*.sql zur Build-Zeit
# (src/db/pglite.ts: `import.meta.glob('../../../schema/*.sql', ...)`),
# das liegt als Sibling-Verzeichnis ausserhalb von frontend/.
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
COPY schema /schema
# Leer = same-origin (Frontend+Backend hinter Traefik unter derselben Domain).
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
