from shop.catalog.search import search


def test_matches_name_words_in_any_order():
    assert [p.sku for p in search("tea green")] == ["TEA-001"]


def test_matches_tags():
    assert [p.sku for p in search("gift")] == ["SET-200"]


def test_blank_query_finds_nothing():
    assert search("   ") == []
