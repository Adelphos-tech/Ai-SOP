FROM python:3.11-slim

# Internal-only service — Next.js is the public entry point.
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py parser.py .

ENV CV_PARSER_TIMEOUT=120
# Bind to loopback only — never expose publicly.
CMD ["uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8099"]
