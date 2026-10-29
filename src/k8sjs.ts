// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.
// Modified: namespace, named ports, probes, args, exporter sidecars and a separate ClusterIP metrics Service.

import * as k8s from "@pulumi/kubernetes";
import * as k8stypes from "@pulumi/kubernetes/types/input";
import * as pulumi from "@pulumi/pulumi";

// Label on the per-component `<name>-metrics` Service that ServiceMonitors select.
export const METRICS_SERVICE_LABEL = "guestbook/metrics";

/**
 * ServiceDeployment is an example abstraction that uses a class to fold together the common pattern of a
 * Kubernetes Deployment and its associated Service object.
 */
export class ServiceDeployment extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;
    public readonly metricsService?: k8s.core.v1.Service;
    public readonly ipAddress?: pulumi.Output<string>;

    constructor(name: string, args: ServiceDeploymentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("k8sjs:service:ServiceDeployment", name, {}, opts);

        const labels = { app: name };
        const portName = args.portName || "http";
        const container: k8stypes.core.v1.Container = {
            name,
            image: args.image,
            args: args.args,
            resources: args.resources || { requests: { cpu: "100m", memory: "100Mi" } },
            env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
            ports: args.ports && args.ports.map(p => ({ name: portName, containerPort: p })),
            readinessProbe: args.readinessProbe,
            livenessProbe: args.livenessProbe,
        };
        this.deployment = new k8s.apps.v1.Deployment(name, {
            metadata: {
                // Fixed name so operators can `kubectl -n guestbook ... deploy/<name>`.
                name: name,
                namespace: args.namespace,
                labels: labels,
            },
            spec: {
                selector: { matchLabels: labels },
                replicas: args.replicas || 1,
                template: {
                    metadata: { labels: labels },
                    spec: { containers: [ container, ...(args.sidecars || []) ] },
                },
            },
        }, { parent: this });

        const servicePorts: k8stypes.core.v1.ServicePort[] =
            (args.ports || []).map(p => ({ name: portName, port: p, targetPort: p }));

        this.service = new k8s.core.v1.Service(name, {
            metadata: {
                name: name,
                namespace: args.namespace,
                labels: this.deployment.metadata.labels,
            },
            spec: {
                ports: servicePorts,
                selector: this.deployment.spec.template.metadata.labels,
                // Minikube does not implement services of type `LoadBalancer`; require the user to specify if we're
                // running on minikube, and if so, create only services of type ClusterIP.
                type: args.allocateIpAddress ? (args.isMinikube ? "ClusterIP" : "LoadBalancer") : undefined,
            },
        }, { parent: this });

        if (args.metricsPort) {
            // Metrics get their own ClusterIP Service so they are never exposed through the app's LoadBalancer.
            this.metricsService = new k8s.core.v1.Service(`${name}-metrics`, {
                metadata: {
                    name: `${name}-metrics`,
                    namespace: args.namespace,
                    labels: { ...labels, [METRICS_SERVICE_LABEL]: "true" },
                },
                spec: {
                    type: "ClusterIP",
                    ports: [{ name: "metrics", port: args.metricsPort, targetPort: args.metricsPort }],
                    selector: this.deployment.spec.template.metadata.labels,
                },
            }, { parent: this });
        }

        if (args.allocateIpAddress) {
            // Cloud load balancers report either an IP (GKE, AKS) or a hostname (EKS).
            this.ipAddress = args.isMinikube ?
                this.service.spec.clusterIP :
                this.service.status.loadBalancer.ingress.apply(ingress => ingress[0].ip || ingress[0].hostname);
        }

        this.registerOutputs({});
    }
}

export interface ServiceDeploymentArgs {
    namespace: pulumi.Input<string>;
    image: string;
    args?: string[];
    resources?: k8stypes.core.v1.ResourceRequirements;
    replicas?: number;
    ports?: number[];
    portName?: string;
    allocateIpAddress?: boolean;
    isMinikube?: boolean;
    readinessProbe?: k8stypes.core.v1.Probe;
    livenessProbe?: k8stypes.core.v1.Probe;
    sidecars?: k8stypes.core.v1.Container[];
    // When set, a ClusterIP `<name>-metrics` Service exposes this port as `metrics` for ServiceMonitor discovery.
    metricsPort?: number;
}
