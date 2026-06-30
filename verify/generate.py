#!/usr/bin/env python3
# Детерминированный генератор СИНТЕТИЧЕСКОГО датасета трафика 3HCloud.
# Смоделирован по реальному распределению (регионы/провайдеры/полоса) из ноябрьского экспорта,
# но без единого реального payer / лицевого счёта / UUID. Засевает 5 типов эксплуататоров
# с ground_truth-меткой (для валидации детектора; сам детектор метку НЕ использует).
import json, random, hashlib

random.seed(42)  # воспроизводимость

# Регион -> (провайдер, валюта, доля). Привязка из реальных данных.
REGION_PROVIDER = {
    'MSK': ('PROCloud', 'RUB'),
    'WAW': ('3hcloud', 'USD'),
    'SFO': ('3hcloud', 'USD'),
    'MIA': ('3hcloud', 'USD'),
    'DFW': ('3hcloud', 'USD'),
    'ALA': ('3HCKZ',  'KZT'),
    'MNL': ('infinivan', 'USD'),
}
# Доли аккаунтов по регионам (≈ из реального распределения строк).
REGION_WEIGHTS = {'MSK': 0.30, 'WAW': 0.20, 'MIA': 0.15, 'ALA': 0.16, 'MNL': 0.08, 'DFW': 0.07, 'SFO': 0.04}

# blended $/Mbps/mo транзита по региону (research/transit-prices.md, оценка по рынку).
TRANSIT_USD_PER_MBPS = {'MIA':0.12,'DFW':0.12,'SFO':0.18,'WAW':0.30,'MSK':0.45,'MNL':0.90,'ALA':1.00}
# FX в USD (для общей экономики; фикс-курс, помечен как допущение).
FX_USD = {'USD':1.0, 'RUB':1/95.0, 'KZT':1/500.0}

# Flat-rate unmetered план: committed Mbps -> месячная цена (USD-eq), грубо из прайса (Dallas-tier).
PLAN_TIERS = [100, 250, 500, 1000]  # committed Mbps
PLAN_PRICE_USD = {100:50, 250:125, 500:250, 1000:475}  # из Flat-Rate Unmetered (Dallas/Miami колонки)

FAKE_FIRST = ['Aurora','Nimbus','Quartz','Helix','Sable','Tundra','Orion','Pixel','Cobalt','Indigo','Forge','Vector','Prism','Granite','Lumen','Mosaic','Onyx','Delta','Zephyr','Atlas']
FAKE_SUF = ['Cloud','Labs','Works','Group','Tech','Digital','Systems','Networks','Studio','Collective','Holding','Data','Logic','Dynamics','Software']

def fake_payer():
    return f"{random.choice(FAKE_FIRST)} {random.choice(FAKE_SUF)}"

def lognorm(mu, sigma, lo, hi):
    import math
    v = math.exp(random.gauss(mu, sigma))
    return max(lo, min(hi, v))

def pick_region():
    r = random.random(); acc = 0
    for reg, w in REGION_WEIGHTS.items():
        acc += w
        if r <= acc: return reg
    return 'MSK'

def base_account(i, region=None):
    region = region or pick_region()
    prov, cur = REGION_PROVIDER[region]
    # обычный аккаунт: умеренная полоса, компьютер пропорционален полосе
    avg_band = round(lognorm(0.2, 1.4, 0.05, 400), 3)      # Mbps sustained
    duty = random.uniform(0.25, 0.6)                        # доля суток под нагрузкой
    peak_band = round(avg_band / max(duty, 0.2), 3)         # ~95th percentile
    committed = min([t for t in PLAN_TIERS if t >= peak_band] + [1000])
    compute_units = round(max(1, avg_band * random.uniform(1.5, 4.0)), 2)  # «толстая» услуга = больше compute
    out_in_ratio = round(random.uniform(0.7, 1.6), 2)
    overage_hours = 0; overage_vol = 0.0
    plan_price = PLAN_PRICE_USD[committed]
    compute_rev = round(compute_units * random.uniform(2.5, 4.0), 2)  # USD-eq
    return dict(account_no=270000+i, payer=fake_payer(), provider=prov, currency=cur, region=region,
                avg_band_mbps=avg_band, peak_band_mbps=peak_band, committed_mbps=committed,
                duty_cycle=round(duty,3), compute_units=compute_units, out_in_ratio=out_in_ratio,
                overage_hours=overage_hours, overage_volume_gb=overage_vol,
                plan_price_usd=plan_price, compute_rev_usd=compute_rev,
                fingerprint=None, ground_truth='clean')

def main():
    accts = []
    N = 380
    for i in range(N):
        accts.append(base_account(i))

    # ── Засев эксплуататоров (мульти-сигнальные, как в реальности) ──
    # Реальный unmetered-эксплойт: ЕДИНАЯ flat-rate цена + дорогой регион + высокая утилизация → транзит > выручки.
    idx = N
    seeded = {'negative_margin':0,'vpn_proxy':0,'overage_abuse':0,'geo_anomaly':0,'duplicate_pattern':0}
    EXP_REGIONS = ['ALA','MNL','MSK']  # дорогой транзит → там и течёт маржа

    # 1) negative_margin: самый дорогой транзит (ALA/MNL), высокий committed-план, утилизация близко к порту
    for _ in range(8):
        a = base_account(idx, region=random.choice(['ALA','MNL'])); idx+=1
        a['committed_mbps'] = 1000
        a['plan_price_usd'] = PLAN_PRICE_USD[1000]              # единая цена $475
        a['avg_band_mbps'] = round(random.uniform(550, 850),3)
        a['duty_cycle'] = round(random.uniform(0.8,0.95),3)
        a['peak_band_mbps'] = round(a['avg_band_mbps']/a['duty_cycle'],3)
        a['compute_units'] = round(random.uniform(2,8),2)       # compute не спасает выручку
        a['compute_rev_usd'] = round(a['compute_units']*3,2)
        a['ground_truth']='negative_margin'; seeded['negative_margin']+=1
        accts.append(a)

    # 2) vpn_proxy: тонкая ВМ, толстая труба, out≈in, 24/7, дешёвый план в дорогом регионе
    for _ in range(7):
        a = base_account(idx, region=random.choice(EXP_REGIONS)); idx+=1
        a['compute_units'] = round(random.uniform(1,3),2)       # крошечный compute
        a['avg_band_mbps'] = round(random.uniform(160, 260),3)  # огромная полоса
        a['duty_cycle'] = round(random.uniform(0.88,0.98),3)    # круглосуточно
        a['peak_band_mbps'] = round(a['avg_band_mbps']/a['duty_cycle'],3)
        a['committed_mbps'] = 250
        a['plan_price_usd'] = PLAN_PRICE_USD[250]               # дёшево платит
        a['out_in_ratio'] = round(random.uniform(0.94,1.07),2)  # симметрия туннеля
        a['compute_rev_usd'] = round(a['compute_units']*3,2)
        a['ground_truth']='vpn_proxy'; seeded['vpn_proxy']+=1
        accts.append(a)

    # 3) overage_abuse: устойчивое превышение committed + часы превышения
    for _ in range(7):
        a = base_account(idx, region=random.choice(EXP_REGIONS+['WAW'])); idx+=1
        a['committed_mbps'] = 250
        a['avg_band_mbps'] = round(random.uniform(380, 620),3)  # выше committed
        a['duty_cycle'] = round(random.uniform(0.65,0.9),3)
        a['peak_band_mbps'] = round(a['avg_band_mbps']/a['duty_cycle'],3)
        a['overage_hours'] = random.randint(120, 420)
        a['overage_volume_gb'] = round(random.uniform(800, 4000),1)
        a['plan_price_usd'] = PLAN_PRICE_USD[250]
        a['compute_units'] = round(random.uniform(3,10),2)
        a['compute_rev_usd'] = round(a['compute_units']*3,2)
        a['ground_truth']='overage_abuse'; seeded['overage_abuse']+=1
        accts.append(a)

    # 4) geo_anomaly: трафик кратно выше медианы региона, в дорогом регионе
    for _ in range(6):
        a = base_account(idx, region=random.choice(['ALA','MNL'])); idx+=1
        a['avg_band_mbps'] = round(random.uniform(650, 1000),3)  # выброс
        a['duty_cycle'] = round(random.uniform(0.6,0.85),3)
        a['peak_band_mbps'] = round(a['avg_band_mbps']/a['duty_cycle'],3)
        a['committed_mbps'] = 1000
        a['plan_price_usd'] = PLAN_PRICE_USD[1000]
        a['compute_units'] = round(random.uniform(15,45),2)     # есть compute (не VPN), но трафик-выброс
        a['compute_rev_usd'] = round(a['compute_units']*3,2)
        a['ground_truth']='geo_anomaly'; seeded['geo_anomaly']+=1
        accts.append(a)

    # 5) duplicate_pattern: кластеры почти идентичных VPN-подобных аккаунтов, каждый чуть НИЖЕ committed (без превышений)
    for cluster in range(3):
        region = random.choice(EXP_REGIONS)
        base_band = random.uniform(190, 240)
        beneficiary = fake_payer()
        for _ in range(random.randint(3,5)):
            a = base_account(idx, region=region); idx+=1
            a['payer'] = beneficiary                            # один бенефициар
            a['committed_mbps'] = 250
            a['compute_units'] = round(random.uniform(1,3),2)   # тонкий compute (клоны-прокси)
            a['avg_band_mbps'] = round(base_band + random.uniform(-3,3),3)  # почти одинаково
            a['duty_cycle'] = 0.92
            a['peak_band_mbps'] = round(min(a['avg_band_mbps']/a['duty_cycle'], 248),3)  # держат ПОД 250, без превышения
            a['overage_hours'] = 0; a['overage_volume_gb']=0.0
            a['plan_price_usd'] = PLAN_PRICE_USD[250]
            a['compute_rev_usd'] = round(a['compute_units']*3,2)
            a['out_in_ratio'] = round(random.uniform(0.96,1.04),2)
            a['ground_truth']='duplicate_pattern'; seeded['duplicate_pattern']+=1
            accts.append(a)

    # fingerprint: округлённый профиль трафика (для дубль-детекции)
    for a in accts:
        fp_src = f"{a['region']}|{round(a['avg_band_mbps']/10)*10}|{a['committed_mbps']}|{round(a['out_in_ratio'],1)}|{round(a['duty_cycle'],1)}"
        a['fingerprint'] = hashlib.md5(fp_src.encode()).hexdigest()[:10]

    meta = dict(synthetic=True,
        note="Synthetic traffic dataset modeled on the real 3HCloud Nov-2025 distribution. No real payer/account/UUID. Exploiters are seeded with ground_truth for validation; the detector does NOT read ground_truth.",
        n_accounts=len(accts), seeded=seeded,
        transit_usd_per_mbps=TRANSIT_USD_PER_MBPS, fx_usd=FX_USD,
        plan_price_usd=PLAN_PRICE_USD,
        detector_weights=dict(margin=0.30, vpn=0.25, overage=0.15, geo=0.15, duplicate=0.15),
        detector_threshold=0.45,
        currencies={'PROCloud':'RUB','3hcloud':'USD','3HCKZ':'KZT','infinivan':'USD'})
    out = dict(_meta=meta, accounts=accts)
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, '..', 'public', 'data', 'accounts.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path,'w'), ensure_ascii=False, indent=1)
    print("wrote", path, "n=", len(accts), "seeded=", seeded)

if __name__=='__main__':
    main()
