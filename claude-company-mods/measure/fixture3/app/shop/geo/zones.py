"""Tax zones. A levy is the fraction of the taxable amount charged as tax."""

from decimal import Decimal

# First two digits of the postcode -> zone. Both ends are inclusive.
_ZONE_RANGES = [
    (0, 19, "northeast"),
    (20, 39, "southeast"),
    (40, 59, "midwest"),
    (60, 79, "central"),
    (80, 89, "mountain"),
    (90, 99, "pacific"),
]

_LEVY = {
    "northeast": Decimal("0.06625"),
    "southeast": Decimal("0.0700"),
    "midwest": Decimal("0.0550"),
    "central": Decimal("0.08125"),
    "mountain": Decimal("0.0485"),
    "pacific": Decimal("0.0925"),
}


class UnknownPostcode(ValueError):
    pass


def zone_for_postcode(postcode):
    if len(postcode) != 5 or not postcode.isdigit():
        raise UnknownPostcode(postcode)
    head = int(postcode[:2])
    for low, high, zone in _ZONE_RANGES:
        if low <= head <= high:
            return zone
    raise UnknownPostcode(postcode)


def levy_for_zone(zone):
    return _LEVY[zone]
