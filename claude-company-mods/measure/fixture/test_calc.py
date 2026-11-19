from calc import average, clamp

assert average([2, 4, 6]) == 4
assert average([5]) == 5
try:
    average([])
    raise SystemExit("FAIL: empty list must raise ValueError")
except ValueError:
    pass
assert clamp(5, 0, 3) == 3 and clamp(-1, 0, 3) == 0
print("OK")
