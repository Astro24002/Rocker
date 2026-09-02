# Official electron-builder image with Node 24 and Wine. Set
# BUILDER_IMAGE to a dated tag or digest when pinning a release build.
ARG BUILDER_IMAGE=electronuserland/builder:24-wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64
FROM ${BUILDER_IMAGE}

WORKDIR /project
ENV CI=true \
    npm_config_update_notifier=false \
    ELECTRON_CACHE=/tmp/electron-cache \
    ELECTRON_BUILDER_CACHE=/tmp/electron-builder-cache
