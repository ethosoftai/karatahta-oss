FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    python-is-python3 \
    build-essential \
    pkg-config \
    ffmpeg \
    libcairo2-dev \
    libpango1.0-dev \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-science \
    dvisvgm \
  && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv \
  && pip install --no-cache-dir --upgrade pip setuptools wheel \
  && pip install --no-cache-dir manim==0.20.1 edge-tts==7.2.8

COPY package*.json ./
RUN npm ci --omit=dev

COPY . ./

RUN mkdir -p renders downloads

EXPOSE 3000

CMD ["node", "server.js"]
