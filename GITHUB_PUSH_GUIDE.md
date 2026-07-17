# GitHub Push Guide for TalentStream

## Prerequisites
- Git installed
- GitHub account with SSH key configured
- `.env` file created from `.env.example` (NOT committed)

## Step-by-Step Push

### Step 1: Initialize Git (if not already)
```bash
git init
```

### Step 2: Add .gitignore FIRST
```bash
git add .gitignore
git commit -m "chore: add comprehensive .gitignore for secrets"
```

### Step 3: Verify no secrets are tracked
```bash
git ls-files | grep -E "\.env|secret|password|key|token"
# Should return NOTHING (except .env.example)
```

### Step 4: Stage all safe files
```bash
git add .
```

### Step 5: Check staged files before committing
```bash
git diff --cached --name-only
# Review this list — ensure no .env, no secrets
```

### Step 6: Commit
```bash
git commit -m "feat: initial TalentStream HR Platform commit"
```

### Step 7: Add remote and push
```bash
git remote add origin git@github.com:YOUR_USERNAME/talentstream.git
git branch -M main
git push -u origin main
```

## Post-Push Verification
- Check GitHub repo — ensure `.env` is NOT present
- Ensure `venv/`, `__pycache__/`, logs, audio files are NOT present
- Clone to a fresh directory and verify `pip install -r requirements.txt` + `.env` setup works
