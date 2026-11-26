"""Money as integer cents. Never use floats for amounts."""

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal


@dataclass(frozen=True, order=True)
class Money:
    cents: int

    def __add__(self, other):
        return Money(self.cents + other.cents)

    def __sub__(self, other):
        return Money(self.cents - other.cents)

    def __str__(self):
        sign = "-" if self.cents < 0 else ""
        whole, frac = divmod(abs(self.cents), 100)
        return f"{sign}{whole}.{frac:02d}"


ZERO = Money(0)


def parse(text):
    """'12.34' -> Money(1234)."""
    return Money(int((Decimal(text) * 100).to_integral_value(ROUND_HALF_EVEN)))


def scale(amount, rate):
    """amount * rate, rounded half-even to the cent. rate is a Decimal."""
    return Money(int((Decimal(amount.cents) * rate).to_integral_value(ROUND_HALF_EVEN)))


def total(amounts):
    out = ZERO
    for a in amounts:
        out = out + a
    return out
