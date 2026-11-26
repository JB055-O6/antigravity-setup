from decimal import Decimal

from shop.money import Money, parse, scale, total


def test_parse_and_str_round_trip():
    assert str(parse("12.34")) == "12.34"
    assert parse("0.5") == Money(50)


def test_negative_amount_prints_sign():
    assert str(Money(-5)) == "-0.05"


def test_scale_rounds_half_even():
    assert scale(Money(250), Decimal("0.01")) == Money(2)
    assert scale(Money(350), Decimal("0.01")) == Money(4)


def test_total_of_nothing_is_zero():
    assert total([]) == Money(0)
    assert total([Money(1), Money(2)]) == Money(3)
