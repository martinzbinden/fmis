# Build-Context ist das REPO-ROOT (siehe docker-compose.yml: `context: .`,
# `dockerfile: frontend/Dockerfile`), nicht frontend/ allein — der Build
# braucht core/frontend/src (geteilte Shell), modules/<name>/frontend/src
# (Seiten/Komponenten je Modul) und modules/<name>/schema (zur Build-Zeit
# per import.meta.glob eingebettet), die als Sibling-Verzeichnisse ausserhalb
# von frontend/ liegen — sowie die Workspace-Root package.json/-lock.json
# (frontend ist ein npm-Workspace-Mitglied, siehe /package.json), damit
# node_modules an EINER Stelle landet und core/modules sie auch auflösen
# können (siehe frontend/vite.config.ts: server.fs.allow / resolve.alias).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci

COPY frontend ./frontend
COPY core/frontend ./core/frontend
COPY modules/livestock/frontend/src ./modules/livestock/frontend/src
COPY modules/livestock/schema ./modules/livestock/schema
COPY modules/dairy/frontend/src ./modules/dairy/frontend/src
COPY modules/dairy/schema ./modules/dairy/schema
COPY modules/fields/frontend/src ./modules/fields/frontend/src
COPY modules/fields/schema ./modules/fields/schema
COPY modules/wiesenjournal/frontend/src ./modules/wiesenjournal/frontend/src
COPY modules/wiesenjournal/schema ./modules/wiesenjournal/schema

# Leer = same-origin (Frontend+Backend hinter Traefik unter derselben Domain).
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
WORKDIR /app/frontend
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
