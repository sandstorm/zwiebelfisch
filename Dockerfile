# The demo playground as one image: `mise run docker:build`, then `mise run docker:run` (or the docker commands in
# mise-tasks/docker/). It serves the built demo on :5199 and runs the collaboration server with the in-memory fake
# GitLab on :1234, as `mise run demo` does; nothing is stored. Ctrl-C (SIGINT) or SIGTERM stops both.
#
# Stage `build` installs the tools mise.toml pins (so the image builds with the same versions as a checkout) and runs
# build:demo. Stage `runtime` is Node only: the built demo (dist/demo), the server's sources and its production
# dependencies. The server serves the demo itself (TYPST_DEMO_DIST, server/src/playground/static-files.ts): no Vite,
# no dev dependencies. Without a checkout the Documentation example saves nothing; the playground bar says so.
# See docs/10_guide/01_getting-started.typ.

FROM debian:bookworm-20261005@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858 AS build

# a C toolchain for Rust's build scripts and, should no prebuilt binary fit, better-sqlite3 (node-gyp: python3, make)
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates curl git python3 \
  && rm -rf /var/lib/apt/lists/*

ARG MISE_VERSION=2026.10.4
ARG MISE_SHA256_AMD64=2b8ce21f550872807bcaabf45b6bc5c64bfbd6dc3bf49dd4e67de700ef3ceb75
ARG MISE_SHA256_ARM64=9013ce1d7d9bbbf65254cda178562f5450c474a705907c18b77e6b678bb10041
ARG TARGETARCH
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN case "$TARGETARCH" in \
      amd64) arch=x64; sha="$MISE_SHA256_AMD64" ;; \
      arm64) arch=arm64; sha="$MISE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${arch}" -o /usr/local/bin/mise \
  && echo "${sha}  /usr/local/bin/mise" | sha256sum -c - \
  && chmod +x /usr/local/bin/mise

ENV MISE_DATA_DIR=/mise MISE_YES=1 MISE_TRUSTED_CONFIG_PATHS=/app PATH=/mise/shims:$PATH \
  CARGO_HOME=/cargo RUSTUP_HOME=/rustup
WORKDIR /app

# The tools, then the JS dependencies: both stay cached until mise.toml or the lockfile change. /deps gets the
# runtime's dependencies from the same lockfile, production only (pnpm installs the root's along with the server's).
COPY mise.toml ./
RUN mise install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --store-dir /pnpm-store \
  && mkdir -p /deps/server \
  && cp package.json pnpm-lock.yaml pnpm-workspace.yaml /deps/ \
  && cp server/package.json /deps/server/ \
  && pnpm install --dir /deps --frozen-lockfile --prod --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=cargo-registry,target=/cargo/registry \
    --mount=type=cache,id=typst-engine-target,target=/app/crates/typst-engine/target \
  mise run build:demo

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime

ENV NODE_ENV=production HOST=0.0.0.0 TYPST_DEMO_DIST=/app/dist/demo
WORKDIR /app
COPY --from=build /deps/node_modules node_modules
COPY --from=build /deps/server/node_modules server/node_modules
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
