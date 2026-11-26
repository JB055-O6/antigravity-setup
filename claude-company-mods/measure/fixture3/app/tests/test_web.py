import io
import json

import pytest

from shop.web import app as web
from shop.web import handlers


class OkGateway:
    def charge(self, order_id, amount):
        return "ch_1"


def call(method, path, body=None, query=""):
    data = json.dumps(body).encode() if body is not None else b""
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": query,
        "CONTENT_LENGTH": str(len(data)),
        "wsgi.input": io.BytesIO(data),
    }
    seen = {}

    def start_response(status, headers):
        seen["status"] = int(status.split()[0])

    out = b"".join(web.app(environ, start_response))
    return seen["status"], json.loads(out)


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    monkeypatch.setattr(handlers, "GATEWAY", OkGateway())
    monkeypatch.setattr(handlers, "STORE", handlers.Store("unused.json"))
    monkeypatch.setattr(handlers, "INVENTORY", handlers.Inventory({"MUG-010": 1, "TEA-001": 10}))


def test_products_lists_every_product():
    status, body = call("GET", "/api/products")
    assert status == 200 and len(body) == 5


def test_checkout_then_summary():
    order = {"items": [{"sku": "TEA-001", "qty": 2}], "customer": {"id": "c1", "postcode": "94107"}}
    status, body = call("POST", "/api/checkout", order)
    assert status == 201 and body["total"] == "18.57"
    status, again = call("GET", f"/api/orders/{body['id']}/summary")
    assert status == 200 and again == body


def test_out_of_stock_is_409():
    order = {"items": [{"sku": "MUG-010", "qty": 2}], "customer": {"postcode": "94107"}}
    assert call("POST", "/api/checkout", order)[0] == 409


def test_unknown_route_is_404():
    assert call("GET", "/nope")[0] == 404
