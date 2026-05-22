# apps/api/Dockerfile
# docs: 11-deployment-guide.md#deploy-api-first
# Build context is apps/api/. Image is built + pushed by infra/cloudbuild.yaml.
FROM python:3.12-slim-bookworm

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN pip install --no-cache-dir uv

# Install dependencies first for better layer caching (BuildKit cache mount).
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev --no-install-project

COPY app/ /app/app

# Put the venv on PATH so we can call uvicorn directly (no `uv run` at runtime).
ENV PATH="/app/.venv/bin:$PATH"

# Non-root user for security.
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid app --shell /bin/bash --create-home app
USER app

EXPOSE 8080
# Cloud Run injects $PORT (defaults to 8080); bind 0.0.0.0 for external traffic.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
