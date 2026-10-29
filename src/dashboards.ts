import * as fs from "fs";
import * as k8s from "@pulumi/kubernetes";
import * as path from "path";
import { MONITORING_NAMESPACE } from "./monitoring";

const DASHBOARD_FILE = "guestbook-overview.json";
const DASHBOARD_PATH = path.join(__dirname, "..", "dashboards", DASHBOARD_FILE);

// The queries the dashboard must contain; tests check the JSON against this list so metric/job renames
// elsewhere can't silently leave the dashboard empty.
export const DASHBOARD_EXPRESSIONS = [
    'sum(rate(apache_accesses_total{job="frontend"}[1m]))',
    'avg_over_time(probe_success{job="frontend-probe"}[5m]) * 100',
    'probe_duration_seconds{job="frontend-probe"}',
    'sum(apache_workers{job="frontend", state="busy"})',
    'sum by (job) (rate(redis_commands_processed_total[1m]))',
    'sum by (job) (redis_connected_clients)',
    'sum by (job) (redis_memory_used_bytes)',
    'redis_connected_slaves{job="redis-leader"}',
    'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="guestbook", container!=""}[5m]))',
    'sum by (pod) (container_memory_working_set_bytes{namespace="guestbook", container!=""})',
    'sum by (pod) (increase(kube_pod_container_status_restarts_total{namespace="guestbook"}[15m]))',
    'ALERTS{alertstate="firing", alertname=~"Guestbook.*"}',
];

export function loadDashboard(file: string): any {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function dashboardConfigMapData(): Record<string, string> {
    return { [DASHBOARD_FILE]: JSON.stringify(loadDashboard(DASHBOARD_PATH)) };
}

/**
 * Grafana's dashboard sidecar (enabled by the kps chart) loads any ConfigMap labelled grafana_dashboard=1.
 */
export function createDashboards(kps: k8s.helm.v3.Release): k8s.core.v1.ConfigMap {
    return new k8s.core.v1.ConfigMap("guestbook-dashboards", {
        metadata: {
            name: "guestbook-dashboards",
            namespace: MONITORING_NAMESPACE,
            labels: { grafana_dashboard: "1" },
        },
        data: dashboardConfigMapData(),
    }, { dependsOn: [kps] });
}
