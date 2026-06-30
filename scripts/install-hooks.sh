#!/bin/bash
# Installs git hooks for this repo. Run once after cloning.
set -e
ROOT=$(git rev-parse --show-toplevel)
HOOK="$ROOT/.git/hooks/pre-push"

cat > "$HOOK" <<'EOF'
#!/bin/bash
# Pre-push: assert all Unsplash images on every trip page (and root index)
# return HTTP 200. Aborts the push if any are broken.
set -e
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

FAIL=0
for f in index.html trips/*/index.html; do
  [ -f "$f" ] || continue
  echo "→ checking $f"
  if ! bash scripts/check-images.sh "$f" > /tmp/check-out 2>&1; then
    echo "✗ broken images in $f:"
    grep BROKEN /tmp/check-out || cat /tmp/check-out
    FAIL=1
  fi
done

if [ $FAIL -ne 0 ]; then
  echo "pre-push aborted — fix broken images or run with --no-verify to bypass."
  exit 1
fi
EOF

chmod +x "$HOOK"
echo "installed: $HOOK"
