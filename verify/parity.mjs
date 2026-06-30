import { readFileSync } from 'fs'
import { detect } from '../src/model.js'
const d = JSON.parse(readFileSync(new URL('../public/data/accounts.json', import.meta.url)))
const r = detect(d.accounts, d._meta)
const byNo = Object.fromEntries(r.scored.map(s => [s.account_no, s]))
// эталон из Python detector_ref.py
const want = { 270416: 0.797218, 270409: 0.797083, 270410: 0.795266, 270000: 0.050000, 270001: 0.220971, 270002: 0.152083 }
let ok = true
for (const [no, w] of Object.entries(want)) {
  const got = byNo[no].score
  const diff = Math.abs(got - w)
  const pass = diff < 0.0005
  ok = ok && pass
  console.log(`#${no} js=${got.toFixed(6)} py=${w} diff=${diff.toExponential(2)} ${pass ? 'PASS' : 'FAIL'}`)
}
// детекция против ground_truth
const gt = {}, caught = {}
for (const s of r.scored) { gt[s.ground_truth] = (gt[s.ground_truth]||0)+1; if (s.flagged) caught[s.ground_truth]=(caught[s.ground_truth]||0)+1 }
console.log('\nDetection:', ['negative_margin','vpn_proxy','overage_abuse','geo_anomaly','duplicate_pattern','clean'].map(k=>`${k} ${caught[k]||0}/${gt[k]||0}`).join(' · '))
console.log('totals:', JSON.stringify(r.totals))
console.log('MNL region:', JSON.stringify(r.byRegion.find(x=>x.region==='MNL')))
console.log(ok ? '\nPARITY: PASS' : '\nPARITY: FAIL')
process.exit(ok?0:1)
