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
# Utilise Node.js 18 en base
FROM node:18-alpine

# Install AWS CLI v2
RUN apt-get update && \
    apt-get install -y curl unzip && \
    curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws

WORKDIR /app

COPY package*.json ./

RUN npm install --legacy-peer-deps 


# Ajoute les dépendances nécessaires à la compilation native
RUN apk add --no-cache python3 make g++ \
    && npm cache clean --force


COPY . .

RUN npm run build

EXPOSE 3033

CMD ["node", "dist/main.js"]


