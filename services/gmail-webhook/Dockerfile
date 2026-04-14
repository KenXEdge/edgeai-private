FROM python:3.12-slim

# Prevent .pyc files and enable unbuffered stdout for Cloud Run logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install deps first (layer-cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY main.py .

# Cloud Run injects $PORT at runtime; default to 8080
ENV PORT=8080

# Use gunicorn with a single worker — Cloud Run scales via instances, not workers.
# 4 threads handle concurrent requests within one instance.
CMD exec gunicorn \
    --bind "0.0.0.0:${PORT}" \
    --workers 1 \
    --threads 4 \
    --timeout 30 \
    --access-logfile - \
    --error-logfile - \
    main:app
