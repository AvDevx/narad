FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

EXPOSE 8080

CMD ["bun", "run", "src/index.js"]
