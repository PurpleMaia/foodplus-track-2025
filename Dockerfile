FROM node:18

# Install cron
RUN apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build Vite frontend
RUN npm run build

# Create .well-known directory for Let's Encrypt
RUN mkdir -p /app/.well-known/acme-challenge && \
    chmod -R 755 /app/.well-known

# Copy and make wrapper executable
COPY scripts/run-cron.sh /app/scripts/run-cron.sh
RUN chmod +x /app/scripts/run-cron.sh

# Initialize cron job with wrapper script
RUN echo "* * * * * /app/scripts/run-cron.sh >> /proc/1/fd/1 2>&1" | crontab -

# Expose port
EXPOSE 5000