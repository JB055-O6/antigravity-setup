import pytest

from shop.payments.breaker import Breaker
from shop.payments.errors import CircuitOpen


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_opens_after_limit_failures():
    b = Breaker(3, 30, Clock())
    for _ in range(3):
        b.check()
        b.failure()
    with pytest.raises(CircuitOpen):
        b.check()


def test_success_resets_count():
    b = Breaker(2, 30, Clock())
    b.failure()
    b.success()
    b.failure()
    b.check()


def test_closes_after_cool_down():
    clock = Clock()
    b = Breaker(2, 30, clock)
    b.failure()
    b.failure()
    clock.now = 30.0
    b.check()
    assert b.failures == 0
    b.failure()
    b.check()
    b.failure()
    with pytest.raises(CircuitOpen):
        b.check()
