"""WSGI entry point and route table. Run: python -m shop.web.app"""

import json
import re
from wsgiref.simple_server import make_server

from shop.web import handlers

ROUTES = [
    ("GET", re.compile(r"^/api/products$"), handlers.list_products),
    ("GET", re.compile(r"^/api/search$"), handlers.search_products),
    ("POST", re.compile(r"^/api/checkout$"), handlers.handle_checkout),
    ("GET", re.compile(r"^/api/orders/(?P<order_id>[\w-]+)/summary$"), handlers.get_summary),
    ("GET", re.compile(r"^/healthz$"), handlers.health),
]

_REASONS = {200: "OK", 201: "Created", 400: "Bad Request", 404: "Not Found", 409: "Conflict", 502: "Bad Gateway"}


def app(environ, start_response):
    method = environ["REQUEST_METHOD"]
    path = environ.get("PATH_INFO", "/")
    for want, pattern, handler in ROUTES:
        match = pattern.match(path)
        if match and want == method:
            status, body = handler(environ, **match.groupdict())
            break
    else:
        status, body = 404, {"error": "not found"}
    data = json.dumps(body).encode()
    headers = [("Content-Type", "application/json"), ("Content-Length", str(len(data)))]
    start_response(f"{status} {_REASONS.get(status, 'Error')}", headers)
    return [data]


if __name__ == "__main__":
    make_server("0.0.0.0", 8080, app).serve_forever()
