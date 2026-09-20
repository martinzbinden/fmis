# Build-Context ist das REPO-ROOT (siehe docker-compose.yml: `context: .`,
# `dockerfile: backend/Dockerfile`), nicht backend/ allein — das Backend
# importiert core/backend/fmis_core (geteilte Auth/DB-Logik) und
# modules/<name>/backend/app + modules/<name>/schema (je Modul), die als
# Sibling-Verzeichnisse ausserhalb von backend/ liegen.
FROM python:3.12-slim

WORKDIR /app

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .

COPY core ./core
COPY modules/__init__.py ./modules/__init__.py
COPY modules/livestock/__init__.py ./modules/livestock/__init__.py
COPY modules/livestock/backend/__init__.py ./modules/livestock/backend/__init__.py
COPY modules/livestock/backend/app ./modules/livestock/backend/app
COPY modules/livestock/schema ./modules/livestock/schema
COPY modules/dairy/__init__.py ./modules/dairy/__init__.py
COPY modules/dairy/backend/__init__.py ./modules/dairy/backend/__init__.py
COPY modules/dairy/backend/app ./modules/dairy/backend/app
COPY modules/dairy/schema ./modules/dairy/schema
COPY modules/fields/__init__.py ./modules/fields/__init__.py
COPY modules/fields/backend/__init__.py ./modules/fields/backend/__init__.py
COPY modules/fields/backend/app ./modules/fields/backend/app
COPY modules/fields/schema ./modules/fields/schema
COPY modules/wiesenjournal/__init__.py ./modules/wiesenjournal/__init__.py
COPY modules/wiesenjournal/backend/__init__.py ./modules/wiesenjournal/backend/__init__.py
COPY modules/wiesenjournal/backend/app ./modules/wiesenjournal/backend/app
COPY modules/wiesenjournal/schema ./modules/wiesenjournal/schema

# WORKDIR /app entspricht dem Repo-Root-Layout (core/, modules/ liegen direkt
# darunter) — core.backend.fmis_core und modules.<name>.backend.app lösen
# sich dadurch ohne zusätzliches PYTHONPATH auf; wir setzen es trotzdem
# explizit, unabhängig davon wie uvicorn das Arbeitsverzeichnis handhabt.
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
