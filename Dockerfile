# The demo playground as one image: `mise run docker:build`, then `mise run docker:run` (or the docker commands in
# mise-tasks/docker/). It serves the built demo on :5199 and runs the collaboration server with the in-memory fake
# GitLab on :1234, as `mise run demo` does; nothing is stored. Ctrl-C (SIGINT) or SIGTERM stops both. GitHub builds it
# for linux/amd64 and linux/arm64 and pushes it to ghcr.io (.github/workflows/docker.yml).
#
# Stage `build` installs the tools mise.toml pins (so the image builds with the same versions as a checkout) and runs
# build:demo. It runs on the building machine's platform: the demo (JS, wasm, fonts) is the same for every platform,
# so a multi-platform build compiles the engine once and natively, never under emulation. Stage `deps` installs the
# server's production dependencies on the target platform (better-sqlite3 is native code). Stage `runtime` is Node
# only: the built demo (dist/demo), the server's sources and those dependencies. The server serves the demo itself
# (TYPST_DEMO_DIST, server/src/playground/static-files.ts): no Vite, no dev dependencies. Without a checkout the
# Documentation example saves nothing; the playground bar says so. See docs/10_getting-started/01_getting-started.typ.
#
# The server is the TypeScript one (server/src) on Node. When the Go server replaces it, only `deps` and `runtime`
# change (a Go build stage and a runtime with its binary); `build` and the dist/demo it hands over stay as they are.

FROM --platform=$BUILDPLATFORM debian:bookworm-20261005@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858 AS build

# a C toolchain for Rust's build scripts and, should no prebuilt binary fit, better-sqlite3 (node-gyp: python3, make),
# needed by the full install here as well
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates curl git python3 \
  && rm -rf /var/lib/apt/lists/*

ARG MISE_VERSION=2026.10.4
ARG MISE_SHA256_AMD64=2b8ce21f550872807bcaabf45b6bc5c64bfbd6dc3bf49dd4e67de700ef3ceb75
ARG MISE_SHA256_ARM64=9013ce1d7d9bbbf65254cda178562f5450c474a705907c18b77e6b678bb10041
ARG BUILDARCH
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN case "$BUILDARCH" in \
      amd64) arch=x64; sha="$MISE_SHA256_AMD64" ;; \
      arm64) arch=arm64; sha="$MISE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $BUILDARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${arch}" -o /usr/local/bin/mise \
  && echo "${sha}  /usr/local/bin/mise" | sha256sum -c - \
  && chmod +x /usr/local/bin/mise

ENV MISE_DATA_DIR=/mise MISE_YES=1 MISE_TRUSTED_CONFIG_PATHS=/app PATH=/mise/shims:$PATH \
  CARGO_HOME=/cargo RUSTUP_HOME=/rustup
WORKDIR /app

# The tools, then the JS dependencies: both stay cached until mise.toml or the lockfile change.
COPY mise.toml ./
RUN mise install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
  pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=cargo-registry,target=/cargo/registry \
    --mount=type=cache,id=typst-engine-target,target=/app/crates/typst-engine/target \
  mise run build:demo

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS deps

# for better-sqlite3, should no prebuilt binary fit this platform (node-gyp: python3, make)
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

# The runtime's dependencies from the lockfile, production only (pnpm installs the root's along with the server's),
# with the pnpm that package.json names (packageManager; the one mise.toml pins).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --store-dir /pnpm-store

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime

ENV NODE_ENV=production HOST=0.0.0.0 TYPST_DEMO_DIST=/app/dist/demo
WORKDIR /app
COPY --from=deps /deps/node_modules node_modules
COPY --from=deps /deps/server/node_modules server/node_modules
COPY --from=build /app/dist/demo dist/demo
# the server's sources and what they read: the room protocol from src/, the fake repository's files
COPY package.json ./
COPY server/package.json server/
COPY server/src server/src
COPY src src
COPY demo/examples/advanced demo/examples/advanced

# the base image's user `node`
USER 1000:1000
EXPOSE 5199 1234
CMD ["node", "server/src/fake-gitlab-main.ts"]
