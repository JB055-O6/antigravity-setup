"""Turns a cart into a price breakdown."""

from shop.catalog.products import get_product
from shop.models import PriceBreakdown
from shop.money import Money, total
from shop.pricing.discounts import discount_for
from shop.pricing.tax import compute_tax


def line_amount(line):
    return Money(get_product(line.sku).price.cents * line.qty)


def price_cart(cart, customer, coupon=None):
    subtotal = total(line_amount(line) for line in cart.lines)
    discount = discount_for(subtotal, customer, coupon)
    tax = compute_tax(subtotal - discount, customer)
    return PriceBreakdown(subtotal=subtotal, discount=discount, tax=tax)
