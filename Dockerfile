# Imagen de la app de Sebas Barber (Node + Express). La base de datos es otro contenedor (Postgres).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Dependencias primero (se reutiliza la caché si no cambian)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1

CMD ["node", "server.js"]
