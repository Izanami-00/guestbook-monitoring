import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { StackConfig } from "./config";
import { versions } from "./versions";

export const MONITORING_NAMESPACE = "monitoring";
export const KPS_RELEASE = "kps";
export const BLACKBOX_RELEASE = "blackbox";
// In-cluster names produced by the charts with the release names above (checked with `helm template`).
export const GRAFANA_SERVICE = `${KPS_RELEASE}-grafana`;
export const PROMETHEUS_SERVICE = `${KPS_RELEASE}-prometheus`;
export const BLACKBOX_SERVICE = `${BLACKBOX_RELEASE}-prometheus-blackbox-exporter`;
export const GRAFANA_ADMIN_USER = "admin";

const PROMETHEUS_COMMUNITY_REPO = "https://prometheus-community.github.io/helm-charts";

/**
 * Values for the kube-prometheus-stack chart.
 */
export function kpsValues(cfg: StackConfig, adminPassword: pulumi.Input<string>): Record<string, any> {
    const values: Record<string, any> = {
        fullnameOverride: KPS_RELEASE,
        prometheus: {
            prometheusSpec: {
                // By default the operator only picks up CRs labelled with this Helm release. Our ServiceMonitors,
                // Probes and rules are managed by Pulumi, so select everything.
                serviceMonitorSelectorNilUsesHelmValues: false,
                podMonitorSelectorNilUsesHelmValues: false,
                probeSelectorNilUsesHelmValues: false,
                ruleSelectorNilUsesHelmValues: false,
                retention: "2d",
                resources: {
                    requests: { cpu: "200m", memory: "512Mi" },
                    limits: { cpu: "1", memory: "1Gi" },
                },
            },
        },
        alertmanager: {
            alertmanagerSpec: {
                resources: {
                    requests: { cpu: "25m", memory: "64Mi" },
                    limits: { cpu: "100m", memory: "128Mi" },
                },
            },
        },
        grafana: {
            adminUser: GRAFANA_ADMIN_USER,
            adminPassword: adminPassword,
            service: cfg.isMinikube
                ? { type: "NodePort", nodePort: cfg.grafanaNodePort }
                : { type: "LoadBalancer" },
            sidecar: {
                dashboards: {
                    enabled: true,
                    label: "grafana_dashboard",
                    labelValue: "1",
                    searchNamespace: "ALL",
                },
            },
            resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
            },
        },
    };

    if (cfg.isMinikube) {
        // These control plane components are not reachable for scraping on minikube; leaving them enabled makes
        // the default rules fire TargetDown/KubeSchedulerDown alerts from the first minute.
        for (const component of ["kubeEtcd", "kubeScheduler", "kubeControllerManager", "kubeProxy"]) {
            values[component] = { enabled: false };
        }
        // minikube's node is itself a Docker container, where `/` is usually not a shared mount; node-exporter's
        // HostToContainer root mount then fails to start and blocks the Helm release. Only filesystem metrics are lost.
        values["prometheus-node-exporter"] = { hostRootFsMount: { enabled: false } };
    }

    return values;
}

export function grafanaAccess(cfg: StackConfig): { accessCommand: string; staticUrl?: string } {
    if (cfg.isMinikube) {
        return {
            accessCommand: `minikube service ${GRAFANA_SERVICE} -n ${MONITORING_NAMESPACE} --url`,
            staticUrl: cfg.minikubeIp ? `http://${cfg.minikubeIp}:${cfg.grafanaNodePort}` : undefined,
        };
    }
    return { accessCommand: `kubectl -n ${MONITORING_NAMESPACE} get svc ${GRAFANA_SERVICE}` };
}

export interface Monitoring {
    namespace: k8s.core.v1.Namespace;
    kps: k8s.helm.v3.Release;
    blackbox: k8s.helm.v3.Release;
    grafanaUrl: pulumi.Output<string>;
    grafanaAccessCommand: string;
    adminUser: string;
    adminPassword: pulumi.Output<string>;
}

export function createMonitoring(cfg: StackConfig): Monitoring {
    const namespace = new k8s.core.v1.Namespace(MONITORING_NAMESPACE, {
        metadata: { name: MONITORING_NAMESPACE },
    });

    const password = new random.RandomPassword("grafana-admin", { length: 20, special: false });

    const kps = new k8s.helm.v3.Release(KPS_RELEASE, {
        name: KPS_RELEASE,
        namespace: namespace.metadata.name,
        chart: "kube-prometheus-stack",
        version: versions.kpsChart,
        repositoryOpts: { repo: PROMETHEUS_COMMUNITY_REPO },
        values: kpsValues(cfg, password.result),
        timeout: 600,
    });

    const blackbox = new k8s.helm.v3.Release(BLACKBOX_RELEASE, {
        name: BLACKBOX_RELEASE,
        namespace: namespace.metadata.name,
        chart: "prometheus-blackbox-exporter",
        version: versions.blackboxChart,
        repositoryOpts: { repo: PROMETHEUS_COMMUNITY_REPO },
        values: {
            resources: {
                requests: { cpu: "25m", memory: "32Mi" },
                limits: { cpu: "100m", memory: "64Mi" },
            },
        },
    });

    const access = grafanaAccess(cfg);
    let grafanaUrl: pulumi.Output<string>;
    if (cfg.isMinikube) {
        grafanaUrl = pulumi.output(access.staticUrl ?? `run: ${access.accessCommand}`);
    } else {
        // Helm waits for LoadBalancer ingress before the release completes, so the address is known here.
        const svc = k8s.core.v1.Service.get("grafana-svc",
            pulumi.interpolate`${kps.status.namespace}/${GRAFANA_SERVICE}`, { dependsOn: [kps] });
        grafanaUrl = svc.status.loadBalancer.ingress.apply(ingress => {
            const address = ingress?.[0]?.ip || ingress?.[0]?.hostname;
            return address ? `http://${address}` : `pending: ${access.accessCommand}`;
        });
    }

    return {
        namespace,
        kps,
        blackbox,
        grafanaUrl,
        grafanaAccessCommand: access.accessCommand,
        adminUser: GRAFANA_ADMIN_USER,
        adminPassword: pulumi.secret(password.result),
    };
}
