FROM buildkite/puppeteer:8.0.0

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

COPY . ./

CMD ["npm", "run", "start"]