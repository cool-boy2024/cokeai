# Opt-in Caddy image with github.com/mholt/caddy-ratelimit.
#
# The default deployment keeps the official image (CADDY_IMAGE=caddy:2-alpine)
# and never uses this Dockerfile. Build it only when edge rate limiting is
# being enabled deliberately; see ops/edge/README.md.
#
# Build from the repository root:
#   docker build -f ops/edge/Dockerfile -t cokeai-caddy:ratelimit .
#
# Pin CADDY_VERSION and the plugin version (see the xcaddy line below) before
# using this image in production, so a rebuild cannot silently pick up a new
# release.

ARG CADDY_VERSION=2

FROM caddy:${CADDY_VERSION}-builder AS builder

# Go's default module proxy is unreachable from some networks (including this
# project's). Override it at build time if needed, e.g.
#   --build-arg GOPROXY=https://goproxy.cn,direct
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

# Pin the module to a release or commit for reproducible builds, e.g.
#   --with github.com/mholt/caddy-ratelimit@v0.1.0
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:${CADDY_VERSION}-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
