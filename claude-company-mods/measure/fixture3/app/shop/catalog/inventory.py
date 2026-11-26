"""Stock levels and reservations."""

from shop.catalog.products import get_product


class OutOfStock(Exception):
    def __init__(self, sku, wanted, left):
        super().__init__(f"{sku}: wanted {wanted}, {left} left")
        self.sku, self.wanted, self.left = sku, wanted, left


class Inventory:
    def __init__(self, levels):
        self.levels = dict(levels)

    def reserve(self, lines):
        """Reserve every line or none of them."""
        for line in lines:
            get_product(line.sku)
            left = self.levels.get(line.sku, 0)
            if line.qty > left:
                raise OutOfStock(line.sku, line.qty, left)
        for line in lines:
            self.levels[line.sku] -= line.qty

    def release(self, lines):
        for line in lines:
            self.levels[line.sku] = self.levels.get(line.sku, 0) + line.qty
