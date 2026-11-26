from shop.models import Cart, Customer
from shop.money import Money
from shop.pricing.engine import price_cart


def cart(*items):
    c = Cart()
    for sku, qty in items:
        c.add(sku, qty)
    return c


def test_standard_customer_pays_subtotal_plus_tax():
    p = price_cart(cart(("TEA-001", 2)), Customer("c1", "Ana", "94107"))
    assert (p.subtotal, p.discount, p.tax, p.total) == (Money(17_00), Money(0), Money(1_57), Money(18_57))


def test_coupon_applies_before_tax():
    p = price_cart(cart(("KET-100", 1)), Customer("c1", "Ana", "02134"), coupon="SPRING15")
    assert (p.discount, p.tax) == (Money(7_35), Money(2_76))


def test_gold_member_at_minimum_gets_discount():
    p = price_cart(cart(("SET-200", 2)), Customer("c2", "Bo", "60601", "gold"))
    assert p.discount == Money(5_00)
    assert p.total == Money(48_66)


def test_mixed_cart_subtotal():
    p = price_cart(cart(("TEA-002", 3), ("MUG-010", 1)), Customer("c1", "Ana", "45202"))
    assert p.subtotal == Money(47_60)
