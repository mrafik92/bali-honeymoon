#!/bin/bash
# Check all Unsplash images in index.html return 200
FAIL=0
rg -o 'images\.unsplash\.com/photo-[a-zA-Z0-9-]+' index.html --no-filename | sort -u | while read id; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://${id}?auto=format&fit=crop&w=100&q=80" 2>/dev/null)
  if [ "$code" != "200" ]; then
    echo "BROKEN ($code) https://${id}"
    FAIL=1
  else
    echo "OK $id"
  fi
done
exit $FAIL