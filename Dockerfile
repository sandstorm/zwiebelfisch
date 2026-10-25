# Zwiebelfisch as one image: the collaboration server (server/cmd/zwiebelfisch) with the app, the start page and the
# editor (dist/app), on one port (1234): `mise run docker:build`, then run it with the GitLab instance's settings
# (mise run docker:run, docs/30_configuration/05_deployment.typ). /data keeps the database and the git clones. GitHub
# builds it for linux/amd64 and linux/arm64 and pushes it to ghcr.io (.github/workflows/docker.yml).
#
# Stage `build` installs the tools mise.toml pins (so the image builds with the same versions as a checkout) and runs
# build:app. Stage `server` cross-compiles the Go server for the target platform (CGO_ENABLED=0: a static binary,
# SQLite is pure Go). Both run on the building machine's platform: the app (JS, wasm, fonts) is the same for every
# platform and Go cross-compiles, so a multi-platform build never runs under emulation. Stage `runtime` is distroless:
# the binary and the built app, which the server serves from ZWF_WEB_DIST.

FROM --platform=$BUILDPLATFORM debian:bookworm-20261005@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858 AS build

# a C toolchain for Rust's build scripts
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates curl git \
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

# Go is the `server` stage's; the CI linters are not needed here
ENV MISE_DATA_DIR=/mise MISE_YES=1 MISE_TRUSTED_CONFIG_PATHS=/app PATH=/mise/shims:$PATH \
  MISE_DISABLE_TOOLS=go,actionlint,hadolint,shellcheck CARGO_HOME=/cargo RUSTUP_HOME=/rustup
WORKDIR /app

# The tools, then the JS dependencies: both stay cached until mise.toml or the lockfile change.
COPY mise.toml ./
RUN mise install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
  pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=cargo-registry,target=/cargo/registry \
    --mount=type=cache,id=typst-engine-target,target=/app/crates/typst-engine/target \
  mise run build:app \
  && mkdir -p /data

# the Go version mise.toml pins
FROM --platform=$BUILDPLATFORM golang:1.27.1-bookworm@sha256:8d48e12ec56735e9358640898b9d9b9fcca110612ed8a5567438c0a1baa24e66 AS server

ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,id=go-mod,target=/go/pkg/mod \
  go mod download
COPY server server
RUN --mount=type=cache,id=go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=go-build,target=/root/.cache/go-build \
  CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath -ldflags="-s -w" -o /out/zwiebelfisch ./server/cmd/zwiebelfisch

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab AS runtime

ENV ZWF_ADDRESS=0.0.0.0 ZWF_WEB_DIST=/app/web ZWF_COLLAB_DB=/data/collab.sqlite ZWF_LOG_FORMAT=json
WORKDIR /app
COPY --from=server /out/zwiebelfisch /app/zwiebelfisch
COPY --from=build /app/dist/app web
# the base image's user `nonroot` owns the volume
COPY --from=build --chown=65532:65532 /data /data
VOLUME /data

USER 65532:65532
EXPOSE 1234
ENTRYPOINT ["/app/zwiebelfisch"]
