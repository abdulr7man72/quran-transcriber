FROM node:20-bullseye-slim

# Install ffmpeg and ffprobe (required for audio compression)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install npm dependencies
RUN npm ci --omit=dev

# Copy the rest of the app
COPY . .

# Create uploads and compressed directories
RUN mkdir -p uploads compressed

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Start the app
# Verify the structure before running
RUN echo "=== Container structure ===" && ls -la /app && ls -la /app/compressed /app/uploads 2>/dev/null
CMD ["node", "server.js"]
