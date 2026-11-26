FROM python:3.12-slim

WORKDIR /app
COPY shop/ shop/
COPY web/ web/

RUN useradd --create-home --uid 10001 shop \
    && mkdir -p /app/data /app/logs \
    && chown shop /app/data /app/logs
USER shop

ENV SHOP_DATA=/app/data/shop.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"
CMD ["python", "-m", "shop.web.app"]
