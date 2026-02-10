---
description: Build, commit, push, and deploy to Vercel production
---

# Deploy to Production

// turbo-all

1. Run the build to check for errors:
```
npm run build
```

2. Stage all changed files:
```
git add -A
```

3. Commit with a descriptive message (use context from recent changes):
```
git commit -m "<descriptive message>"
```

4. Push to GitHub:
```
git push origin master
```

5. Deploy to Vercel production:
```
npx vercel --prod
```

6. Monitor the Vercel deployment until it completes. Report the production URL back to the user.
