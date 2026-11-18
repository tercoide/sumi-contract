# sumi-contract's web version in a container, for Google Cloud Run (or any server).
#   docker build -t sumi-contract web/
#   docker run -p 8064:8064 -e SUMI_HOST=0.0.0.0 -v $PWD/data:/data sumi-contract
# The data folder (/data) must outlive the container: on Cloud Run, a Cloud Storage bucket mounted as a volume,
# with one instance at most (max-instances 1: the server keeps the projects in memory). Google sign-in is needed
# to listen beyond localhost: google-keys.json and login.json in /data (see src/server/auth.ts).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production SUMI_DATA=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/i18n ./src/i18n
COPY --from=build /app/library ./library
USER node
EXPOSE 8064
CMD ["node", "--enable-source-maps", "dist/src/server/main.js"]
