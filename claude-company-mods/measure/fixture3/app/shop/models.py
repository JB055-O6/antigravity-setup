"""Plain data records shared by every layer."""

from dataclasses import dataclass, field

from shop.money import Money


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    price: Money
    tags: tuple = ()


@dataclass
class CartLine:
    sku: str
    qty: int


@dataclass
class Cart:
    lines: list = field(default_factory=list)

    def add(self, sku, qty=1):
        if qty < 1:
            raise ValueError(f"qty must be at least 1, got {qty}")
        for line in self.lines:
            if line.sku == sku:
                line.qty += qty
                return
        self.lines.append(CartLine(sku, qty))


@dataclass(frozen=True)
class Customer:
    id: str
    name: str
    postcode: str
    tier: str = "standard"


@dataclass
class PriceBreakdown:
    subtotal: Money
    discount: Money
    tax: Money

    @property
    def total(self):
        return self.subtotal - self.discount + self.tax


@dataclass
class Order:
    id: str
    customer_id: str
    lines: list
    price: PriceBreakdown
    status: str = "new"
    charge_id: str = ""
