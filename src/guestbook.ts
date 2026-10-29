import * as k8s from "@pulumi/kubernetes";
import * as k8stypes from "@pulumi/kubernetes/types/input";
import * as pulumi from "@pulumi/pulumi";
import { StackConfig } from "./config";
import { ServiceDeployment } from "./k8sjs";
import { versions } from "./versions";

export const GUESTBOOK_NAMESPACE = "guestbook";
export const APACHE_EXPORTER_PORT = 9117;
export const REDIS_EXPORTER_PORT = 9121;

const sidecarResources = {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "100m", memory: "128Mi" },
};

const appResources = {
    requests: { cpu: "100m", memory: "128Mi" },
    limits: { cpu: "250m", memory: "256Mi" },
};

/**
 * Reads Apache's mod_status page over the pod-local loopback. The frontend image ships mod_status with
 * `Require local`, which a same-pod sidecar satisfies.
 */
export function apacheExporterSidecar(): k8stypes.core.v1.Container {
    return {
        name: "apache-exporter",
        image: versions.apacheExporterImage,
        args: [
            "--scrape_uri=http://localhost/server-status?auto",
            `--web.listen-address=:${APACHE_EXPORTER_PORT}`,
        ],
        ports: [{ name: "metrics", containerPort: APACHE_EXPORTER_PORT }],
        resources: sidecarResources,
    };
}

export function redisExporterSidecar(): k8stypes.core.v1.Container {
    return {
        name: "redis-exporter",
        image: versions.redisExporterImage,
        env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
        ports: [{ name: "metrics", containerPort: REDIS_EXPORTER_PORT }],
        resources: sidecarResources,
    };
}

const redisProbes = {
    readinessProbe: { tcpSocket: { port: 6379 }, initialDelaySeconds: 5, periodSeconds: 10 },
    livenessProbe: { tcpSocket: { port: 6379 }, initialDelaySeconds: 15, periodSeconds: 20 },
};

export interface Guestbook {
    namespace: k8s.core.v1.Namespace;
    frontend: ServiceDeployment;
    redisLeader: ServiceDeployment;
    redisReplica: ServiceDeployment;
    frontendUrl: pulumi.Output<string>;
}

export function createGuestbook(cfg: StackConfig): Guestbook {
    const namespace = new k8s.core.v1.Namespace(GUESTBOOK_NAMESPACE, {
        metadata: { name: GUESTBOOK_NAMESPACE },
    });
    const ns = namespace.metadata.name;

    const redisLeader = new ServiceDeployment("redis-leader", {
        namespace: ns,
        image: versions.redisImage,
        ports: [6379],
        portName: "redis",
        resources: appResources,
        ...redisProbes,
        sidecars: [redisExporterSidecar()],
        metricsPort: REDIS_EXPORTER_PORT,
    });

    // Upstream uses pulumi/guestbook-redis-replica, which is amd64-only; the official multi-arch redis image
    // with --replicaof is equivalent and also runs on arm64 nodes.
    const redisReplica = new ServiceDeployment("redis-replica", {
        namespace: ns,
        image: versions.redisImage,
        args: ["--replicaof", "redis-leader", "6379"],
        ports: [6379],
        portName: "redis",
        resources: appResources,
        ...redisProbes,
        sidecars: [redisExporterSidecar()],
        metricsPort: REDIS_EXPORTER_PORT,
    }, { dependsOn: [redisLeader] });

    const frontend = new ServiceDeployment("frontend", {
        namespace: ns,
        replicas: 3,
        image: versions.frontendImage,
        ports: [80],
        allocateIpAddress: true,
        isMinikube: cfg.isMinikube,
        resources: appResources,
        readinessProbe: { httpGet: { path: "/", port: 80 }, initialDelaySeconds: 5, periodSeconds: 10 },
        livenessProbe: { httpGet: { path: "/", port: 80 }, initialDelaySeconds: 15, periodSeconds: 20 },
        sidecars: [apacheExporterSidecar()],
        metricsPort: APACHE_EXPORTER_PORT,
    }, { dependsOn: [redisLeader, redisReplica] });

    const frontendUrl = cfg.isMinikube
        ? pulumi.output(`kubectl -n ${GUESTBOOK_NAMESPACE} port-forward svc/frontend 8080:80  # then open http://localhost:8080`)
        : pulumi.interpolate`http://${frontend.ipAddress}`;

    return { namespace, frontend, redisLeader, redisReplica, frontendUrl };
}
