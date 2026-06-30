#!/usr/bin/env python3
# Python-эталон детектора. Должен совпадать с src/model.js до 3-го знака.
import json, os, statistics
here = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(here,'..','public','data','accounts.json')))
accts = d['accounts']; meta = d['_meta']
W = meta['detector_weights']; TR = meta['transit_usd_per_mbps']; THR = meta.get('detector_threshold',0.45)
REGIONS = ['MSK','WAW','SFO','MIA','DFW','ALA','MNL']
clamp = lambda x,a,b: max(a,min(b,x))
def median(xs):
    xs=sorted(xs); n=len(xs)
    if n==0: return 0
    m=n//2
    return xs[m] if n%2 else (xs[m-1]+xs[m])/2
regMed={r:median([a['avg_band_mbps'] for a in accts if a['region']==r]) for r in REGIONS}
from collections import Counter, defaultdict
fpCount=Counter(a['fingerprint'] for a in accts)
fpPayers=defaultdict(set)
for a in accts: fpPayers[a['fingerprint']].add(a['payer'])

def score_one(a):
    revenue=a['plan_price_usd']+a['compute_rev_usd']
    transit=a['peak_band_mbps']*TR.get(a['region'],0.3)
    margin=revenue-transit
    ratio=transit/revenue if revenue>0 else 2
    sMargin=clamp((ratio-0.5)/1.0,0,1)
    cpm=a['compute_units']/a['avg_band_mbps'] if a['avg_band_mbps']>0 else 99
    sCompute=clamp((3.0-cpm)/3.0,0,1)
    sSym=clamp(1-abs(a['out_in_ratio']-1.0)/0.3,0,1)
    sDuty=clamp((a['duty_cycle']-0.6)/0.35,0,1)
    sVpn=clamp(0.5*sCompute+0.25*sSym+0.25*sDuty,0,1)
    overRatio=a['avg_band_mbps']/a['committed_mbps'] if a['committed_mbps']>0 else 0
    sOverage=clamp(0.5*clamp(overRatio-1,0,1)+0.5*clamp(a['overage_hours']/300,0,1),0,1)
    z=a['avg_band_mbps']/regMed[a['region']] if regMed[a['region']]>0 else 0
    sGeo=clamp((z-3)/7,0,1)
    dupN=fpCount[a['fingerprint']]
    sDup=clamp((dupN-1)/3,0,1)
    if dupN>=2 and len(fpPayers[a['fingerprint']])<dupN: sDup=max(sDup,0.6)
    if dupN>=2 and a['overage_hours']==0 and a['avg_band_mbps']>0.7*a['committed_mbps']: sDup=max(sDup,0.7)
    score=W['margin']*sMargin+W['vpn']*sVpn+W['overage']*sOverage+W['geo']*sGeo+W['duplicate']*sDup
    return dict(account_no=a['account_no'],region=a['region'],revenue=revenue,transit=transit,
                margin=margin,score=score,gt=a['ground_truth'],flagged=score>=THR,
                sub=dict(margin=sMargin,vpn=sVpn,overage=sOverage,geo=sGeo,duplicate=sDup))
scored=[score_one(a) for a in accts]

# экономика по регионам
print("=== REGION ECONOMICS (USD-eq) ===")
for r in REGIONS:
    cr=[s for s in scored if s['region']==r]
    if not cr: continue
    rev=sum(s['revenue'] for s in cr); cost=sum(s['transit'] for s in cr)
    fl=[s for s in cr if s['flagged']]
    print(f"{r}: n={len(cr)} rev=${rev:.0f} cost=${cost:.0f} margin=${rev-cost:.0f} flagged={len(fl)}")
tot_rev=sum(s['revenue'] for s in scored); tot_cost=sum(s['transit'] for s in scored)
print(f"TOTAL rev=${tot_rev:.0f} cost=${tot_cost:.0f} margin=${tot_rev-tot_cost:.0f} flagged={sum(1 for s in scored if s['flagged'])} negMargin={sum(1 for s in scored if s['margin']<0)}")

# качество детекции против ground_truth
print("\n=== DETECTION QUALITY vs ground_truth ===")
from collections import Counter
gt=Counter(s['gt'] for s in scored)
caught=Counter(s['gt'] for s in scored if s['flagged'])
for k in ['negative_margin','vpn_proxy','overage_abuse','geo_anomaly','duplicate_pattern','clean']:
    print(f"  {k}: flagged {caught.get(k,0)}/{gt.get(k,0)}")

# parity samples
print("\n=== PARITY SAMPLES (account_no -> score 6dp) ===")
for s in sorted(scored,key=lambda x:-x['score'])[:3]:
    print(f"  {s['account_no']} {s['score']:.6f} margin={s['margin']:.3f} gt={s['gt']}")
for s in scored[:3]:
    print(f"  {s['account_no']} {s['score']:.6f}")
