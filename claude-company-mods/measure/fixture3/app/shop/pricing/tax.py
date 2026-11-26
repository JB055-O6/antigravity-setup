"""Sales tax on the discounted subtotal."""

from shop.geo.zones import levy_for_zone, zone_for_postcode
from shop.money import scale


def compute_tax(taxable, customer):
    zone = zone_for_postcode(customer.postcode)
    return scale(taxable, levy_for_zone(zone))
