import pytest

from shop.catalog.inventory import Inventory, OutOfStock
from shop.catalog.products import UnknownProduct
from shop.models import CartLine


def test_reserve_takes_stock():
    inv = Inventory({"MUG-010": 3})
    inv.reserve([CartLine("MUG-010", 2)])
    assert inv.levels["MUG-010"] == 1


def test_reserve_is_all_or_nothing():
    inv = Inventory({"MUG-010": 3, "TEA-001": 1})
    with pytest.raises(OutOfStock):
        inv.reserve([CartLine("MUG-010", 2), CartLine("TEA-001", 5)])
    assert inv.levels == {"MUG-010": 3, "TEA-001": 1}


def test_unknown_sku_is_refused():
    with pytest.raises(UnknownProduct):
        Inventory({}).reserve([CartLine("NOPE-1", 1)])


def test_release_returns_stock():
    inv = Inventory({"MUG-010": 0})
    inv.release([CartLine("MUG-010", 2)])
    assert inv.levels["MUG-010"] == 2
