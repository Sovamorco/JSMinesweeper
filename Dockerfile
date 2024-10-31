FROM node:22

WORKDIR /src

COPY package.json .
COPY package-lock.json .

RUN npm ci

COPY . .

ENTRYPOINT ["node", "index.js"]
