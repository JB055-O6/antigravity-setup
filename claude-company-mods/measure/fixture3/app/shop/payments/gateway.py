"""HTTP client for the card gateway, behind a circuit breaker."""

import json
import urllib.error
import urllib.request

from shop import config
from shop.payments.breaker import Breaker
from shop.payments.errors import PaymentDeclined, PaymentGatewayTimeout


class Gateway:
    def __init__(self, url=None, timeout_ms=None, opener=urllib.request.urlopen):
        self.url = url or config.PAYMENT_GATEWAY_URL
        self.timeout_s = (timeout_ms or config.PAYMENT_TIMEOUT_MS) / 1000
        self.opener = opener
        self.breaker = Breaker(config.BREAKER_FAILURES, config.BREAKER_RESET_S)

    def charge(self, order_id, amount):
        self.breaker.check()
        body = json.dumps({"order": order_id, "amount_cents": amount.cents}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"})
        try:
            with self.opener(req, timeout=self.timeout_s) as resp:
                reply = json.load(resp)
        except TimeoutError as exc:
            self.breaker.failure()
            raise PaymentGatewayTimeout(f"no answer in {self.timeout_s * 1000:.0f} ms") from exc
        except urllib.error.HTTPError as exc:
            self.breaker.failure()
            raise PaymentDeclined(f"gateway said {exc.code}") from exc
        self.breaker.success()
        if reply.get("status") != "approved":
            raise PaymentDeclined(reply.get("reason", "declined"))
        return reply["charge_id"]
