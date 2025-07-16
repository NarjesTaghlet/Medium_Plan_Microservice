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
# Utilise une image de base Node.js Alpine
FROM node:18-alpine

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances applicatives (axios, nestjs, etc.)
RUN npm install --legacy-peer-deps

# Copier le reste des fichiers
COPY . .

# Build le projet NestJS
RUN npm run build

# Exposer le port sur lequel ton app écoute
EXPOSE 3004

# Lancer l'application
CMD ["node", "dist/main.js"]


EXPOSE 3004

CMD ["node", "dist/main.js"]

