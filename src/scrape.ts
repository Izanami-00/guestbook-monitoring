import * as k8s from "@pulumi/kubernetes";
import { GUESTBOOK_NAMESPACE } from "./guestbook";
import { METRICS_SERVICE_LABEL } from "./k8sjs";
import { BLACKBOX_SERVICE, MONITORING_NAMESPACE } from "./monitoring";

// Prometheus sets the `job` label to the Service name, so these are also the job names used by alerts/dashboards.
export const SCRAPE_TARGETS = ["frontend", "redis-leader", "redis-replica"];
export const FRONTEND_PROBE_JOB = "frontend-probe";
const SCRAPE_INTERVAL = "15s";

export function serviceMonitorSpec(app: string): object {
    return {
        selector: { matchLabels: { app, [METRICS_SERVICE_LABEL]: "true" } },
        // Take the job name from the Service's `app` label so job="frontend", not "frontend-metrics".
        jobLabel: "app",
        namespaceSelector: { matchNames: [GUESTBOOK_NAMESPACE] },
        endpoints: [{ port: "metrics", interval: SCRAPE_INTERVAL }],
    };
}

export function frontendProbeSpec(): object {
    return {
        jobName: FRONTEND_PROBE_JOB,
        interval: SCRAPE_INTERVAL,
        module: "http_2xx",
        prober: { url: `${BLACKBOX_SERVICE}.${MONITORING_NAMESPACE}.svc:9115` },
        targets: { staticConfig: { static: [`http://frontend.${GUESTBOOK_NAMESPACE}.svc.cluster.local`] } },
    };
}

export function createScrapeConfigs(deps: { kps: k8s.helm.v3.Release; blackbox: k8s.helm.v3.Release }):
    k8s.apiextensions.CustomResource[] {
    // The ServiceMonitor and Probe CRDs are installed by the kps chart, so these must wait for it.
    const opts = { dependsOn: [deps.kps, deps.blackbox] };

    const serviceMonitors = SCRAPE_TARGETS.map(app => new k8s.apiextensions.CustomResource(`${app}-servicemonitor`, {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: { name: app, namespace: MONITORING_NAMESPACE },
        spec: serviceMonitorSpec(app),
    }, opts));

    const probe = new k8s.apiextensions.CustomResource(FRONTEND_PROBE_JOB, {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "Probe",
        metadata: { name: FRONTEND_PROBE_JOB, namespace: MONITORING_NAMESPACE },
        spec: frontendProbeSpec(),
    }, opts);

    return [...serviceMonitors, probe];
}
