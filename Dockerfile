# Utilise Node.js 18 en base
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install -g @nestjs/cli --legacy-peer-deps 


# Ajoute les dépendances nécessaires à la compilation native
RUN  npm install --production --legacy-peer-deps \
    && npm cache clean --force


COPY . .

RUN npm run build

EXPOSE 3004

CMD ["node", "dist/main.js"]
