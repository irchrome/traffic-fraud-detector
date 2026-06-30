# Деплой на GitHub Pages — runbook

Репозиторий: **`traffic-fraud-detector`** · public · base уже в `vite.config.js`.

> На твоём Mac (`git`, `node`, авторизованный `gh`; если нет — `gh auth login` + `gh auth setup-git`).

```bash
cd "/Users/revvoensvet/Documents/IR/110-test_tasks/2026-07-01-traffic-fraud-detector/prototype"

# чтобы внешний репозиторий IR не цеплял прототип
grep -qxF "110-test_tasks/2026-07-01-traffic-fraud-detector/prototype/" "/Users/revvoensvet/Documents/IR/.gitignore" \
  || echo "110-test_tasks/2026-07-01-traffic-fraud-detector/prototype/" >> "/Users/revvoensvet/Documents/IR/.gitignore"

npm install
gh auth setup-git                 # чтобы gh-pages смог пушить (иначе 401)
git init -b main && git add . && git commit -m "Traffic fraud & unmetered economics detector — synthetic 3HCloud demo"
gh repo create traffic-fraud-detector --public --source=. --remote=origin --push
npm run deploy
gh api --method POST repos/{owner}/{repo}/pages -f "source[branch]=gh-pages" -f "source[path]=/" \
  || echo "Pages включи вручную: Settings → Pages → gh-pages /(root)"
```

URL: `https://<username>.github.io/traffic-fraud-detector/` (1–2 мин на первую сборку).

Обновить: `git add . && git commit -m "update" && git push && npm run deploy`.
Если `gh-pages` даёт 401 — `rm -rf node_modules/.cache/gh-pages && npm run deploy`, либо
`npx gh-pages -d dist -r "https://x-access-token:$(gh auth token)@github.com/<username>/traffic-fraud-detector.git"`.
