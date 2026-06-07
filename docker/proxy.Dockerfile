FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY src/III-Drone-Contracts /app/III-Drone-Contracts
COPY src/III-Drone-GC /app/III-Drone-GC

RUN pip install --no-cache-dir /app/III-Drone-Contracts /app/III-Drone-GC

EXPOSE 8780

CMD ["iii-gc-proxy"]
