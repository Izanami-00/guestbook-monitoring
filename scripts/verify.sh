#!/usr/bin/env bash
# Post-deploy verification: checks that Prometheus is scraping the guestbook, metrics are queryable, the alert rules
# are loaded and Grafana serves the Guestbook Overview dashboard. Exits non-zero if any check fails.
# Requires: kubectl (pointing at the cluster), curl, jq, pulumi (logged in to the stack's backend, with
# PULUMI_CONFIG_PASSPHRASE(_FILE) exported or a .pulumi-passphrase file in the project directory).
set -euo pipefail

cd "$(dirname "$0")/.."

PROM_PORT="${PROM_PORT:-19090}"
GRAFANA_PORT="${GRAFANA_PORT:-13000}"
failures=0
pids=()

cleanup() {
    for pid in "${pids[@]:-}"; do
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }

port_forward() {
    local svc="$1" mapping="$2" url="$3"
    kubectl -n monitoring port-forward "svc/$svc" "$mapping" >/dev/null 2>&1 &
    pids+=("$!")
    for _ in $(seq 1 30); do
        if curl -s -o /dev/null "$url"; then
            return 0
        fi
        sleep 1
    done
    echo "could not port-forward to svc/$svc" >&2
    exit 1
}

# Use the project's passphrase file (see README) unless a passphrase is already provided.
if [ -z "${PULUMI_CONFIG_PASSPHRASE:-}" ] && [ -z "${PULUMI_CONFIG_PASSPHRASE_FILE:-}" ] && [ -f .pulumi-passphrase ]; then
    export PULUMI_CONFIG_PASSPHRASE_FILE="$PWD/.pulumi-passphrase"
fi

# Read the Grafana credentials first: with the local backend this needs PULUMI_CONFIG_PASSPHRASE, and failing
# here is clearer than failing after all the Prometheus checks.
if ! password="$(pulumi stack output grafanaAdminPassword --show-secrets 2>/dev/null)" || [ -z "$password" ]; then
    echo "cannot read grafanaAdminPassword from the Pulumi stack;" >&2
    echo "run from the project directory with the stack selected and PULUMI_CONFIG_PASSPHRASE(_FILE) exported" >&2
    exit 1
fi
user="$(pulumi stack output grafanaAdminUser)"

prom="http://localhost:$PROM_PORT"
grafana="http://localhost:$GRAFANA_PORT"
port_forward kps-prometheus "$PROM_PORT:9090" "$prom/-/ready"
port_forward kps-grafana "$GRAFANA_PORT:80" "$grafana/api/health"

# Evaluates a PromQL expression and returns the first sample value (empty if no result).
query() {
    curl -sfG "$prom/api/v1/query" --data-urlencode "query=$1" | jq -r '.data.result[0].value[1] // empty'
}

echo "== Prometheus scrape targets"
targets="$(curl -sf "$prom/api/v1/targets?state=active")"
for job in frontend redis-leader redis-replica frontend-probe; do
    up="$(jq --arg job "$job" '[.data.activeTargets[] | select(.labels.job == $job and .health == "up")] | length' <<<"$targets")"
    if [ "$up" -ge 1 ]; then
        pass "job $job has $up healthy target(s)"
    else
        fail "job $job has no healthy targets"
    fi
done

echo "== Guestbook metrics"
check_query() {
    local description="$1" expr="$2" value
    value="$(query "$expr")"
    if [ -n "$value" ]; then
        pass "$description ($expr = $value)"
    else
        fail "$description ($expr returned no data)"
    fi
}
check_query "frontend is serving requests"         'sum(apache_accesses_total{job="frontend"}) > 0'
check_query "both redis instances are up"          'min(redis_up{namespace="guestbook"}) == 1'
check_query "replica is attached to the leader"    'redis_connected_slaves{job="redis-leader"} >= 1'
check_query "blackbox probe of the frontend passes" 'probe_success{job="frontend-probe"} == 1'
check_query "pod resource metrics are collected"   'count(container_memory_working_set_bytes{namespace="guestbook", container!=""}) >= 5'
check_query "kube-state-metrics sees the pods"     'count(kube_pod_info{namespace="guestbook"}) >= 5'

echo "== Alert rules"
rules="$(curl -sf "$prom/api/v1/rules" | jq '[.data.groups[] | select(.name == "guestbook.rules") | .rules[]] | length')"
if [ "$rules" -eq 8 ]; then
    pass "guestbook.rules loaded with 8 rules"
else
    fail "guestbook.rules has $rules rules loaded (expected 8)"
fi
firing="$(curl -sf "$prom/api/v1/alerts" | jq -r '[.data.alerts[] | select(.state == "firing" and (.labels.alertname | startswith("Guestbook"))) | .labels.alertname] | unique | join(", ")')"
if [ -z "$firing" ]; then
    pass "no guestbook alerts firing"
else
    fail "guestbook alerts firing: $firing"
fi

echo "== Grafana"
if [ "$(curl -sf "$grafana/api/health" | jq -r .database)" = "ok" ]; then
    pass "Grafana is healthy"
else
    fail "Grafana health check failed"
fi
uid="$(curl -sf -u "$user:$password" "$grafana/api/search?query=Guestbook%20Overview" | jq -r '.[0].uid // empty')"
if [ "$uid" = "guestbook-overview" ]; then
    pass "Guestbook Overview dashboard is provisioned"
else
    fail "Guestbook Overview dashboard not found (check admin credentials and the grafana_dashboard ConfigMap)"
fi

echo
if [ "$failures" -gt 0 ]; then
    echo "$failures check(s) failed"
    exit 1
fi
echo "all checks passed"
