from decimal import Decimal

import pytest

from shop.geo.zones import UnknownPostcode, levy_for_zone, zone_for_postcode
from shop.models import Customer
from shop.money import Money
from shop.pricing.tax import compute_tax


@pytest.mark.parametrize(
    "postcode,zone",
    [("02134", "northeast"), ("30301", "southeast"), ("60601", "central"), ("94107", "pacific")],
)
def test_zone_for_postcode(postcode, zone):
    assert zone_for_postcode(postcode) == zone


def test_bad_postcode_raises():
    for bad in ("", "1234", "ABCDE", "123456"):
        with pytest.raises(UnknownPostcode):
            zone_for_postcode(bad)


def test_tax_uses_zone_levy():
    assert compute_tax(Money(100_00), Customer("c1", "Ana", "94107")) == Money(9_25)
    assert levy_for_zone("mountain") == Decimal("0.0485")
