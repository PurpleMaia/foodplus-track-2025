#!/bin/bash

# Export current environment variables to a file that cron can source
printenv | sed 's/^\(.*\)$/export \1/g' | grep -v "^export _" > /app/.cron-env

# Start cron daemon
cron

# Start the Node.js server
exec node server/index.js