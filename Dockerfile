FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

# /data è il volume persistente (settings, storico prodotti, video MP4)
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4280 \
    DATA_DIR=/data

EXPOSE 4280

CMD ["node", "server.js"]
