import pytest

from shop.models import Customer
from shop.money import Money
from shop.pricing.discounts import UnknownCoupon, coupon_discount, discount_for, loyalty_discount


def test_gold_above_minimum_gets_ten_percent():
    assert loyalty_discount(Money(80_00), "gold") == Money(8_00)


def test_below_minimum_gets_nothing():
    assert loyalty_discount(Money(49_99), "gold") == Money(0)
    assert loyalty_discount(Money(74_99), "silver") == Money(0)


def test_standard_tier_gets_nothing():
    assert loyalty_discount(Money(500_00), "standard") == Money(0)


def test_fixed_coupon_never_exceeds_subtotal():
    assert coupon_discount(Money(3_00), "welcome5") == Money(3_00)


def test_unknown_coupon_raises():
    with pytest.raises(UnknownCoupon):
        coupon_discount(Money(10_00), "NOPE")


def test_larger_discount_wins():
    gold = Customer("c1", "Ana", "10001", "gold")
    assert discount_for(Money(100_00), gold, "SPRING15") == Money(15_00)
    assert discount_for(Money(100_00), gold, "WELCOME5") == Money(10_00)
