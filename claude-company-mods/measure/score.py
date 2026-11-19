import json, sys, glob, os, re
TRUTH = {'t1': r'governor\.ts:21\b', 't2': r'line 004499 of filler text', 't3': r'^\D*1626\D*$'}
rows = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.jsonl'))):
    t, arm = os.path.basename(f)[:-6].split('-')
    res, tools, models = None, [], {}
    for l in open(f):
        try: d = json.loads(l)
        except Exception: continue
        if d.get('type') == 'assistant':
            for c in d['message'].get('content', []):
                if c.get('type') == 'tool_use': tools.append(c['name'] + ('' if c['name'] != 'Read' else str({k: v for k, v in c['input'].items() if k != 'file_path'})))
        if d.get('type') == 'result': res = d
    if not res: rows.append((t, arm, 'NO RESULT')); continue
    u = res.get('usage', {}); ans = (res.get('result') or '').strip()
    ok = bool(re.search(TRUTH[t], ans, re.M))
    mu = {k: round(v.get('costUSD', 0), 4) for k, v in (res.get('modelUsage') or {}).items()}
    rows.append((t, arm, 'PASS' if ok else 'FAIL', round(res.get('total_cost_usd', 0), 4),
                 u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0),
                 u.get('output_tokens', 0), res.get('num_turns'), mu, tools, ans[:80]))
for r in rows: print(*r, sep=' | ')
