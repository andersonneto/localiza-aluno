FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TZ_NAME=America/Belem
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd -r -u 10001 appuser
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request as u;u.urlopen('http://127.0.0.1:8000/api/saude',timeout=3)" || exit 1
# 1 worker: as sessões ficam em memória (nada é gravado em disco)
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--workers","1","--proxy-headers","--forwarded-allow-ips","*"]
