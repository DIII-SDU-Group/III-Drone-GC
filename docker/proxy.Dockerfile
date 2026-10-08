FROM python:3.12.14-slim-trixie@sha256:7a8b475003c4fe15a2cd4e55e5cfc2f3560bdc9333d624f24cdd6d4340fd7a17
ARG SOURCE_DATE_EPOCH=0

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

WORKDIR /app

COPY src/III-Drone-GC/docker/proxy-requirements.lock /app/proxy-requirements.lock
COPY src/III-Drone-Contracts/setup.py src/III-Drone-Contracts/package.xml /app/III-Drone-Contracts/
COPY src/III-Drone-Contracts/resource /app/III-Drone-Contracts/resource
COPY src/III-Drone-Contracts/iii_drone_contracts /app/III-Drone-Contracts/iii_drone_contracts
COPY src/III-Drone-GC/setup.py src/III-Drone-GC/package.xml /app/III-Drone-GC/
COPY src/III-Drone-GC/resource /app/III-Drone-GC/resource
COPY src/III-Drone-GC/iii_drone_gc /app/III-Drone-GC/iii_drone_gc

RUN pip install --no-cache-dir --only-binary=:all: --require-hashes --requirement /app/proxy-requirements.lock \
    && pip install --no-cache-dir --no-build-isolation --no-deps /app/III-Drone-Contracts /app/III-Drone-GC \
    && python -c "from iii_drone_gc.v2_proxy.app import create_app; create_app()"

EXPOSE 8780

CMD ["iii-gc-proxy"]
