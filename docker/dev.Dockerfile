# Development image: runs `next dev` with hot reload.
# The source code is bind-mounted by compose.yaml; this image only provides
# Node and the installed node_modules. The production image comes in phase 11.
FROM node:24-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app
RUN chown node:node /app
# Run as the unprivileged "node" user (uid 1000, same as the usual WSL user,
# so files created through the bind mount keep the right owner).
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Pre-create .next so the anonymous volume mounted there is owned by "node".
RUN mkdir -p .next

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
