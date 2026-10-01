FROM oven/bun:1-debian AS base

WORKDIR /app

# Install system dependencies (ffmpeg is needed for audio transcription/STT)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy lockfile and package descriptor for dependency installation
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Pre-download Whisper model (~42MB) into image cache so STT works out-of-the-box
RUN bun -e "import { pipeline } from '@xenova/transformers'; await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');"

# Copy source code and project configuration
COPY tsconfig.json ./
COPY servers.example.json ./
COPY src ./src

# Default application port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3001}/ || exit 1

# Start Lucy server
CMD ["bun", "run", "./src/server.ts"]
