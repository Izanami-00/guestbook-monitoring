import * as k8s from "@pulumi/kubernetes";
import { MONITORING_NAMESPACE } from "./monitoring";

export interface AlertRule {
    alert: string;
    expr: string;
    for: string;
    labels: { severity: "critical" | "warning" };
    annotations: { summary: string; description: string };
}

export interface RuleGroup {
    name: string;
    rules: AlertRule[];
}

function rule(alert: string, expr: string, duration: string, severity: "critical" | "warning",
              summary: string, description: string): AlertRule {
    return {
        alert,
        expr,
        for: duration,
        labels: { severity },
        annotations: { summary, description },
    };
}

export function guestbookRuleGroups(): RuleGroup[] {
    return [{
        name: "guestbook.rules",
        rules: [
            rule("GuestbookFrontendScrapeDown",
                'up{job="frontend"} == 0', "2m", "critical",
                "Guestbook frontend metrics target is down",
                "Prometheus cannot scrape the frontend exporter on {{ $labels.pod }} for 2 minutes."),
            rule("GuestbookFrontendProbeFailing",
                'probe_success{job="frontend-probe"} == 0', "2m", "critical",
                "Guestbook frontend is not serving HTTP 2xx",
                "The blackbox probe against the frontend Service has failed for 2 minutes; users cannot load the guestbook."),
            rule("GuestbookFrontendProbeSlow",
                'probe_duration_seconds{job="frontend-probe"} > 1', "5m", "warning",
                "Guestbook frontend is slow",
                "The frontend probe has taken more than 1s for 5 minutes (currently {{ $value | humanizeDuration }})."),
            rule("GuestbookRedisDown",
                'redis_up{namespace="guestbook"} == 0', "1m", "critical",
                "Guestbook Redis is down",
                "redis_exporter on {{ $labels.pod }} ({{ $labels.job }}) cannot reach Redis for 1 minute."),
            rule("GuestbookRedisReplicationBroken",
                'redis_connected_slaves{job="redis-leader"} < 1', "5m", "warning",
                "Guestbook Redis leader has no connected replicas",
                "No replica has been connected to redis-leader for 5 minutes; frontend reads will fail or go stale."),
            rule("GuestbookPodCrashLooping",
                'increase(kube_pod_container_status_restarts_total{namespace="guestbook"}[15m]) > 3', "0m", "warning",
                "Guestbook container is restarting repeatedly",
                "{{ $labels.pod }}/{{ $labels.container }} restarted more than 3 times in the last 15 minutes."),
            rule("GuestbookContainerMemoryHigh",
                'max by (pod, container) (container_memory_working_set_bytes{namespace="guestbook", container!=""})'
                + ' / max by (pod, container) (kube_pod_container_resource_limits{namespace="guestbook", resource="memory"})'
                + ' > 0.9', "5m", "warning",
                "Guestbook container memory is near its limit",
                "{{ $labels.pod }}/{{ $labels.container }} is using {{ $value | humanizePercentage }} of its memory limit."),
            // The ratio alone false-fires for bursty containers with small limits (CFS only counts periods in which
            // the container was runnable), so also require at least 50ms of throttled time per second.
            rule("GuestbookCPUThrottling",
                '(sum by (pod, container) (rate(container_cpu_cfs_throttled_periods_total{namespace="guestbook"}[5m]))'
                + ' / sum by (pod, container) (rate(container_cpu_cfs_periods_total{namespace="guestbook"}[5m]))'
                + ' > 0.25)'
                + ' and sum by (pod, container) (rate(container_cpu_cfs_throttled_seconds_total{namespace="guestbook"}[5m]))'
                + ' > 0.05', "10m", "warning",
                "Guestbook container is CPU throttled",
                "{{ $labels.pod }}/{{ $labels.container }} is throttled in {{ $value | humanizePercentage }} of CPU periods."),
        ],
    }];
}

export function createAlerts(kps: k8s.helm.v3.Release): k8s.apiextensions.CustomResource {
    return new k8s.apiextensions.CustomResource("guestbook-alerts", {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "guestbook-alerts", namespace: MONITORING_NAMESPACE },
        spec: { groups: guestbookRuleGroups() },
    }, { dependsOn: [kps] });
}
