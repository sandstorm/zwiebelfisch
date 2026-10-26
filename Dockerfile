# Zwiebelfisch as one image: the collaboration server (server/cmd/zwiebelfisch) with the app, the start page and the
# editor (dist/app, built beforehand by `mise run build:app`), on one port (1234): `mise run docker:build`, then run it
# with the GitLab instance's settings (mise run docker:run, docs/30_configuration/05_deployment.typ). /data keeps the
# database and the git clones. GitHub builds it for linux/amd64 and linux/arm64 and pushes it to ghcr.io
# (.github/workflows/docker.yml).
#
# Stage `server` cross-compiles the Go server for the target platform on the building machine's platform
# (CGO_ENABLED=0: a static binary, SQLite is pure Go), so a multi-platform build never runs under emulation. Stage
# `runtime` is distroless: the binary and the built app, which the server serves from ZWF_WEB_DIST.

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
  CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath -ldflags="-s -w" -o /out/zwiebelfisch ./server/cmd/zwiebelfisch \
  && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab AS runtime

ENV ZWF_ADDRESS=0.0.0.0 ZWF_WEB_DIST=/app/web ZWF_COLLAB_DB=/data/collab.sqlite ZWF_LOG_FORMAT=json
WORKDIR /app
COPY --from=server /out/zwiebelfisch /app/zwiebelfisch
COPY dist/app web
# the base image's user `nonroot` owns the volume
COPY --from=server --chown=65532:65532 /out/data /data
VOLUME /data

USER 65532:65532
EXPOSE 1234
ENTRYPOINT ["/app/zwiebelfisch"]
