# # Utilise Node.js 18 en base
# FROM node:18-alpine

# WORKDIR /app

# COPY package*.json ./

# RUN npm i --save-dev @types/node --legacy-peer-deps 

# RUN npm install -g @nestjs/cli --legacy-peer-deps 


# # Ajoute les dépendances nécessaires à la compilation native
# RUN  npm install --legacy-peer-deps \
#     && npm cache clean --force


# COPY . .

# RUN npm run build

# EXPOSE 3004

# CMD ["node", "dist/main.js"]


# Étape de build
# Étape 1 : Construction
FROM node:18-alpine AS builder

WORKDIR /app

# Copie uniquement les fichiers de dépendances
COPY package*.json ./

# Installation des dépendances
RUN npm install --legacy-peer-deps

# Copie le reste du code
COPY . .

# Build NestJS
RUN npm run build

# Étape 2 : Image légère pour exécution
FROM node:18-alpine

WORKDIR /app

# Copie uniquement ce qui est nécessaire
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose port
EXPOSE 3004

CMD ["node", "dist/main.js"]


EXPOSE 3004

CMD ["node", "dist/main.js"]

