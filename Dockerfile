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

RUN apk add --no-cache aws-cli

RUN aws --version   


# Install Terraform
ENV TERRAFORM_VERSION=1.7.2
RUN wget https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip && \
    unzip terraform_${TERRAFORM_VERSION}_linux_amd64.zip && \
    mv terraform /usr/local/bin/ && \
    rm terraform_${TERRAFORM_VERSION}_linux_amd64.zip && \
    terraform -version


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


