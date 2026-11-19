import sys, json, os
sys.path.insert(0, '/root/.cache/.bx'); import grade
OUT = sys.argv[1]
for p in ['p19', 'p21', 'p24', 'p25', 'p26', 'p27']:
    res = {}
    for l in open(f'{OUT}/{p}.jsonl'):
        try: d = json.loads(l)
        except Exception: continue
        if d.get('type') == 'result': res = d
    reply = res.get('result') or ''
    try: s, det = getattr(grade, 'g' + p[1:])(f'{OUT}/{p}', reply)
    except Exception as e: s, det = 0, {'grader_error': repr(e)[:120]}
    print(p, round(float(s), 3), round(res.get('total_cost_usd') or 0, 4), res.get('num_turns'), str(det)[:110])
