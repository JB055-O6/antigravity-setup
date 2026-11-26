"""Order storage: an in-memory dict, written to a JSON file on flush."""

import json
import os

from shop import config


class Store:
    def __init__(self, path=None):
        self.path = path or config.DATA_PATH
        self.orders = {}
        self._next = 1

    def new_id(self):
        oid = f"o-{self._next:06d}"
        self._next += 1
        return oid

    def save(self, order):
        self.orders[order.id] = order

    def get(self, order_id):
        return self.orders.get(order_id)

    def flush(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        rows = {
            oid: {"customer": o.customer_id, "status": o.status, "total": o.price.total.cents}
            for oid, o in self.orders.items()
        }
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2, sort_keys=True)
        os.replace(tmp, self.path)
