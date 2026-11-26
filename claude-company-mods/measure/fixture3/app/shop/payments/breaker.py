"""Circuit breaker: after N failures in a row, fail fast for a while."""

import time

from shop.payments.errors import CircuitOpen


class Breaker:
    def __init__(self, failures, reset_s, clock=time.monotonic):
        self.limit = failures
        self.reset_s = reset_s
        self.clock = clock
        self.failures = 0
        self.opened_at = None

    def check(self):
        if self.opened_at is None:
            return
        if self.clock() - self.opened_at >= self.reset_s:
            self.opened_at = None
            self.failures = 0
            return
        raise CircuitOpen("payments circuit open")

    def failure(self):
        self.failures += 1
        if self.failures >= self.limit:
            self.opened_at = self.clock()

    def success(self):
        self.failures = 0
