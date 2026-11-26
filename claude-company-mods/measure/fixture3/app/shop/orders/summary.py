"""The order summary the web API returns."""


def order_summary(order):
    p = order.price
    return {
        "id": order.id,
        "status": order.status,
        "items": [{"sku": line.sku, "qty": line.qty} for line in order.lines],
        "subtotal": str(p.subtotal),
        "discount": str(p.discount),
        "tax": str(p.tax),
        "total": str(p.total),
    }
