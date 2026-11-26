"""Case-insensitive search over product names and tags."""

from shop.catalog.products import all_products


def search(query, limit=20):
    words = [w for w in query.lower().split() if w]
    if not words:
        return []
    hits = []
    for product in all_products():
        text = " ".join((product.name.lower(),) + product.tags)
        if all(w in text for w in words):
            hits.append(product)
    return hits[:limit]
