#!/bin/bash
# Usage: check-images.sh <html-file>
# Greps all images.unsplash.com photo IDs from the file, fetches each as a
# small thumbnail, asserts HTTP 200 on every one. Exits non-zero if any image
# is broken.

set -u
FILE="${1:?Usage: check-images.sh <html-file>}"

if [ ! -f "$FILE" ]; then
  echo "error: file not found: $FILE" >&2
  exit 2
fi

FAIL=0
while read -r id; do
  url="https://${id}?auto=format&fit=crop&w=100&q=80"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" 2>/dev/null || echo "000")
  if [ "$code" != "200" ]; then
    echo "BROKEN ($code) $url"
    FAIL=1
  else
    echo "OK $id"
  fi
done < <(rg -o 'images\.unsplash\.com/photo-[a-zA-Z0-9_-]+' "$FILE" --no-filename | sort -u)

exit $FAIL
