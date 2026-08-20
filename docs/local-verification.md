# Local verification record

The local-only workflow was verified with `LOCAL_MODE=true`, a temporary MySQL 8.4 instance, the generated Drizzle migration, a manually submitted lender URL, and local Chromium capture of `https://example.com`. The app persisted the local operator, lender, successful scrape attempt, extracted evidence keys, and filesystem screenshot/text artifacts.

The sandbox kernel rejected Docker bridge-network iptables rules when running `docker compose -f docker-compose.local.yml up -d`. A temporary host-network MySQL container was used solely for the sandbox verification. This is a sandbox infrastructure restriction rather than a required project configuration; the repository retains the normal `docker-compose.local.yml` workflow intended for Docker Desktop and standard Linux Docker installations.
