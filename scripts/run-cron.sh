#!/bin/bash
set -a
source /etc/profile
set +a
cd /app
exec node ./server/scrape-bills.js