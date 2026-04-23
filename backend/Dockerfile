FROM node:20-alpine

WORKDIR /app

# System dependencies:
#  - openssl + libc6-compat: required by Prisma engines on Alpine
#  - python3 / make / g++: native-module build toolchain
#  - cairo/pango/jpeg/etc.: image libs used by tesseract/pdfkit
RUN apk add --no-cache \
    openssl \
    libc6-compat \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Install dependencies first for better layer caching
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
