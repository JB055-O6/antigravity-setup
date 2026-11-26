import json

import pytest

from shop.catalog.inventory import Inventory
from shop.models import Cart, Customer
from shop.orders.service import CheckoutFailed, place_order
from shop.payments.errors import PaymentGatewayTimeout
from shop.storage import Store

ANA = Customer("c1", "Ana", "94107")


class FakeGateway:
    def __init__(self, fail=None):
        self.fail = fail
        self.calls = []

    def charge(self, order_id, amount):
        self.calls.append((order_id, amount))
        if self.fail:
            raise self.fail
        return f"ch_{order_id}"


def make(fail=None):
    cart = Cart()
    cart.add("MUG-010", 2)
    return cart, Store("unused.json"), Inventory({"MUG-010": 5}), FakeGateway(fail)


def test_paid_order_is_saved():
    cart, store, inv, gw = make()
    order = place_order(cart, ANA, store=store, inventory=inv, gateway=gw)
    assert order.status == "paid" and order.charge_id == "ch_o-000001"
    assert store.get(order.id) is order and inv.levels["MUG-010"] == 3
    assert gw.calls == [("o-000001", order.price.total)]


def test_gateway_timeout_releases_stock():
    cart, store, inv, gw = make(PaymentGatewayTimeout("no answer in 30000 ms"))
    with pytest.raises(CheckoutFailed) as err:
        place_order(cart, ANA, store=store, inventory=inv, gateway=gw)
    assert isinstance(err.value.__cause__, PaymentGatewayTimeout)
    assert inv.levels["MUG-010"] == 5 and store.orders == {}


def test_empty_cart_is_refused():
    _, store, inv, gw = make()
    with pytest.raises(CheckoutFailed):
        place_order(Cart(), ANA, store=store, inventory=inv, gateway=gw)
    assert gw.calls == []


def test_flush_writes_json(tmp_path):
    cart, _, inv, gw = make()
    store = Store(str(tmp_path / "data" / "shop.json"))
    order = place_order(cart, ANA, store=store, inventory=inv, gateway=gw)
    store.flush()
    saved = json.loads((tmp_path / "data" / "shop.json").read_text())
    assert saved == {order.id: {"customer": "c1", "status": "paid", "total": order.price.total.cents}}
