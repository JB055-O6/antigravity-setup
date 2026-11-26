"""Coupon and loyalty discounts. The larger one wins; they never stack."""

from decimal import Decimal

from shop.money import ZERO, Money, scale

# tier -> (minimum subtotal in cents, rate). A subtotal equal to the minimum qualifies.
LOYALTY = {
    "gold": (50_00, Decimal("0.10")),
    "silver": (75_00, Decimal("0.05")),
}

COUPONS = {
    "WELCOME5": ("fixed", Money(5_00)),
    "SPRING15": ("rate", Decimal("0.15")),
}


class UnknownCoupon(ValueError):
    pass


def loyalty_discount(subtotal, tier):
    rule = LOYALTY.get(tier)
    if rule is None:
        return ZERO
    minimum, rate = rule
    if subtotal.cents > minimum:
        return scale(subtotal, rate)
    return ZERO


def coupon_discount(subtotal, code):
    try:
        kind, value = COUPONS[code.upper()]
    except KeyError:
        raise UnknownCoupon(code) from None
    if kind == "fixed":
        return min(value, subtotal)
    return scale(subtotal, value)


def discount_for(subtotal, customer, coupon=None):
    best = loyalty_discount(subtotal, customer.tier)
    if coupon:
        best = max(best, coupon_discount(subtotal, coupon))
    return best
