"""Runtime settings, read once from the environment."""

import os


def _int(name, default):
    raw = os.environ.get(name)
    return int(raw) if raw else default


DATA_PATH = os.environ.get("SHOP_DATA", "data/shop.json")
PAYMENT_GATEWAY_URL = os.environ.get("SHOP_GATEWAY_URL", "https://pay.example-gw.internal/v2/charge")
# Fail fast: a checkout that waits 30 s for the gateway holds a worker thread the whole time.
PAYMENT_TIMEOUT_MS = _int("SHOP_PAYMENT_TIMEOUT_MS", 10000)
BREAKER_FAILURES = _int("SHOP_BREAKER_FAILURES", 5)
BREAKER_RESET_S = _int("SHOP_BREAKER_RESET_S", 30)
CURRENCY = "USD"
