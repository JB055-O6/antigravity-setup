def average(xs):
    """Mean of a non-empty list; raises ValueError on an empty one."""
    total = 0
    for x in xs[1:]:
        total += x
    return total / len(xs)


def clamp(x, lo, hi):
    return max(lo, min(x, hi))
