"""The product list. A real deployment loads it from the catalog service."""

from shop.models import Product
from shop.money import parse

_PRODUCTS = [
    Product("TEA-001", "Sencha green tea 100 g", parse("8.50"), ("tea", "green")),
    Product("TEA-002", "Assam black tea 250 g", parse("11.20"), ("tea", "black")),
    Product("MUG-010", "Stoneware mug", parse("14.00"), ("mug",)),
    Product("KET-100", "Gooseneck kettle", parse("49.00"), ("kettle",)),
    Product("SET-200", "Tasting set, 6 teas", parse("25.00"), ("tea", "gift")),
]
_BY_SKU = {p.sku: p for p in _PRODUCTS}


class UnknownProduct(KeyError):
    pass


def get_product(sku):
    try:
        return _BY_SKU[sku]
    except KeyError:
        raise UnknownProduct(sku) from None


def all_products():
    return list(_PRODUCTS)
