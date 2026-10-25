FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace backend
COPY backend backend
COPY schemas schemas
COPY shared shared
RUN mkdir -p /app/uploads && chown node:node /app/uploads
WORKDIR /app/backend
USER node
CMD ["npm", "start"]
