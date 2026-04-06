#!/bin/bash
# Auto-discover attack surface when /security-audit is activated
echo "## Attack Surface Discovery"
echo ""

# Find HTTP entry points
echo "### HTTP Entry Points"
count=$(grep -rl --include='*.ts' --include='*.js' --include='*.py' -E '(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch)|@(Get|Post|Put|Delete|Patch)|@app\.route)' . 2>/dev/null | grep -v node_modules | wc -l)
echo "Found $count files with HTTP handlers"
if [ "$count" -gt 0 ]; then
  grep -rl --include='*.ts' --include='*.js' --include='*.py' -E '(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch)|@(Get|Post|Put|Delete|Patch)|@app\.route)' . 2>/dev/null | grep -v node_modules | head -20
fi
echo ""

# Find auth-related code
echo "### Auth-Related Files"
grep -rl --include='*.ts' --include='*.js' --include='*.py' -iE '(auth|login|session|token|jwt|password|bcrypt|argon|oauth)' . 2>/dev/null | grep -v node_modules | head -20
echo ""

# Find database queries
echo "### Database Query Files"
grep -rl --include='*.ts' --include='*.js' --include='*.py' -iE '(SELECT|INSERT|UPDATE|DELETE|\.query\(|\.execute\(|prisma\.|knex\.|sequelize\.)' . 2>/dev/null | grep -v node_modules | head -20
echo ""

# Find potential secrets
echo "### Potential Hardcoded Secrets"
grep -rn --include='*.ts' --include='*.js' --include='*.py' -E '(api[_-]?key|secret|password|token)\s*[:=]\s*["\x27][^"\x27]{8,}' . 2>/dev/null | grep -v node_modules | grep -v '.test.' | head -10
echo ""

# Check for .env in git
echo "### Git-Tracked Sensitive Files"
git ls-files | grep -iE '\.env$|credentials|\.pem$|\.key$|id_rsa' 2>/dev/null
echo ""

echo "---"
echo "Use this discovery data to focus your audit on the highest-risk areas."
