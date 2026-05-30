FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages uv
RUN corepack enable

COPY pyproject.toml uv.lock ./
RUN uv sync --python 3.11 --frozen

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @paper-hunter/web build

ENV NODE_ENV=production
ENV PAPER_HUNTER_STORAGE=/app/storage
EXPOSE 3000

CMD ["bash", "scripts/start-container.sh"]
