import json, sys, glob, os, re
from collections import defaultdict
OUT = sys.argv[1]
TRUTH = {'t1': r'governor\.ts:21\b', 't2': r'line 004499 of filler text', 't3': r'^\D*1626\D*$'}
cells = defaultdict(list)
for f in sorted(glob.glob(os.path.join(OUT, 't*.jsonl'))):
    t, arm, rep = os.path.basename(f)[:-6].split('-')
    res, models = None, set()
    for l in open(f):
        try: d = json.loads(l)
        except Exception: continue
        if d.get('type') == 'result': res = d
    if not res: cells[(t, arm)].append(('NO RESULT', 0, 0, '')); continue
    ans = (res.get('result') or '').strip()
    if t == 't4':
        g = open(os.path.join(OUT, f't4-{arm}-{rep}.grade')).read().strip()
    else:
        g = 'PASS' if re.search(TRUTH[t], ans, re.M) else 'FAIL'
    u = res.get('usage', {})
    tok = u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0)
    mu = ','.join(sorted(k.replace('claude-', '') for k in (res.get('modelUsage') or {})))
    cells[(t, arm)].append((g, res.get('total_cost_usd', 0), tok, mu))
print('task | setup | grades | mean cost $ | mean input tok | models')
for t in ['t1', 't2', 't3', 't4']:
    for arm in ['base', 'mod']:
        r = cells.get((t, arm), [])
        if not r: continue
        print(t, arm, '/'.join(x[0] for x in r), round(sum(x[1] for x in r) / len(r), 4), round(sum(x[2] for x in r) / len(r)), r[0][3], sep=' | ')
tot = {a: sum(x[1] for (t, arm), v in cells.items() if arm == a for x in v) for a in ['base', 'mod']}
print('total $', {k: round(v, 4) for k, v in tot.items()})
