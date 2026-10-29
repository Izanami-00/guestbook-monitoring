import * as assert from "assert";
import * as pulumi from "@pulumi/pulumi";
import { parseConfig, StackConfig } from "../src/config";
import { createStack, StackOutputs } from "../src/stack";
import { versions } from "../src/versions";

// Runs the whole program against Pulumi's mock engine (no CLI, no cluster) and inspects what would be registered.

interface Registered {
    type: string;
    name: string;
    inputs: any;
}

const LB_IP = "203.0.113.10";

function resolve<T>(output: pulumi.Output<T>): Promise<T> {
    return new Promise(r => output.apply(v => { r(v); return v; }));
}

async function run(cfg: StackConfig): Promise<{ resources: Registered[]; outputs: StackOutputs }> {
    const resources: Registered[] = [];
    await pulumi.runtime.setMocks({
        newResource(args: pulumi.runtime.MockResourceArgs) {
            resources.push({ type: args.type, name: args.name, inputs: args.inputs });
            const state: any = { ...args.inputs };
            if (args.type === "random:index/randomPassword:RandomPassword") {
                state.result = "mock-password-123";
            }
            if (args.type === "kubernetes:helm.sh/v3:Release") {
                state.status = { name: args.inputs.name, namespace: args.inputs.namespace };
            }
            if (args.type === "kubernetes:core/v1:Service") {
                state.spec = { ...(args.inputs.spec || {}), clusterIP: "10.0.0.1" };
                state.status = { loadBalancer: { ingress: [{ ip: LB_IP }] } };
            }
            return { id: `${args.name}-id`, state };
        },
        call(args: pulumi.runtime.MockCallArgs) {
            return args.inputs;
        },
    }, "guestbook-monitoring", "test", false);

    const outputs = createStack(cfg);
    await Promise.all([resolve(outputs.frontendUrl), resolve(outputs.grafanaUrl), resolve(outputs.grafanaAdminPassword)]);
    // Let any remaining registrations flush.
    await new Promise(r => setTimeout(r, 100));
    return { resources: resources.filter(r => !r.type.startsWith("pulumi:")), outputs };
}

const ofType = (rs: Registered[], type: string) => rs.filter(r => r.type === type);
const deployment = (rs: Registered[], name: string) =>
    ofType(rs, "kubernetes:apps/v1:Deployment").find(r => r.inputs.metadata.name === name)!;
const service = (rs: Registered[], name: string) =>
    ofType(rs, "kubernetes:core/v1:Service").find(r => r.inputs.metadata?.name === name && r.inputs.spec)!;
const customResources = (rs: Registered[], kind: string) =>
    ofType(rs, `kubernetes:monitoring.coreos.com/v1:${kind}`);

describe("program (Pulumi mocks)", function () {
    describe("minikube", () => {
        let resources: Registered[];
        let outputs: StackOutputs;
        before(async () => ({ resources, outputs } = await run(parseConfig({ isMinikube: true }))));

        it("creates the guestbook and monitoring namespaces", () => assert.deepStrictEqual(
            ofType(resources, "kubernetes:core/v1:Namespace").map(r => r.inputs.metadata.name).sort(),
            ["guestbook", "monitoring"]));

        it("deploys guestbook workloads and loadgen into the guestbook namespace", () => {
            for (const name of ["frontend", "redis-leader", "redis-replica", "loadgen"]) {
                const d = deployment(resources, name);
                assert.ok(d, name);
                assert.strictEqual(d.inputs.metadata.namespace, "guestbook", name);
            }
        });

        it("gives every container requests and limits", () => {
            for (const d of ofType(resources, "kubernetes:apps/v1:Deployment")) {
                for (const c of d.inputs.spec.template.spec.containers) {
                    assert.ok(c.resources?.requests && c.resources?.limits, `${d.inputs.metadata.name}/${c.name}`);
                }
            }
        });

        it("never deploys a floating image tag", () => {
            for (const d of ofType(resources, "kubernetes:apps/v1:Deployment")) {
                for (const c of d.inputs.spec.template.spec.containers) {
                    assert.match(c.image, /(:[^:/]+|@sha256:[0-9a-f]{64})$/, c.image);
                    assert.doesNotMatch(c.image, /:latest$/, c.image);
                }
            }
        });

        it("adds an exporter sidecar to each scraped workload", () => {
            const sidecars = (name: string) =>
                deployment(resources, name).inputs.spec.template.spec.containers.map((c: any) => c.name);
            assert.deepStrictEqual(sidecars("frontend"), ["frontend", "apache-exporter"]);
            assert.deepStrictEqual(sidecars("redis-leader"), ["redis-leader", "redis-exporter"]);
            assert.deepStrictEqual(sidecars("redis-replica"), ["redis-replica", "redis-exporter"]);
        });

        it("runs the replica off the multi-arch redis image replicating from redis-leader", () => {
            const c = deployment(resources, "redis-replica").inputs.spec.template.spec.containers[0];
            assert.strictEqual(c.image, versions.redisImage);
            assert.deepStrictEqual(c.args, ["--replicaof", "redis-leader", "6379"]);
        });

        it("every ServiceMonitor matches a Service that exposes a metrics port", () => {
            const monitors = customResources(resources, "ServiceMonitor");
            assert.strictEqual(monitors.length, 3);
            for (const m of monitors) {
                const app = m.inputs.spec.selector.matchLabels.app;
                const svc = service(resources, `${app}-metrics`);
                assert.ok(svc, app);
                assert.strictEqual(svc.inputs.metadata.namespace, m.inputs.spec.namespaceSelector.matchNames[0]);
                assert.deepStrictEqual(svc.inputs.metadata.labels, m.inputs.spec.selector.matchLabels);
                // jobLabel=app keeps job="<component>" even though the Service is named <component>-metrics.
                assert.strictEqual(svc.inputs.metadata.labels[m.inputs.spec.jobLabel], app);
                assert.ok(svc.inputs.spec.ports.some((p: any) => p.name === m.inputs.spec.endpoints[0].port), app);
            }
        });

        it("Service metrics ports point at the sidecar's container port", () => {
            for (const name of ["frontend", "redis-leader", "redis-replica"]) {
                const metricsPort = service(resources, `${name}-metrics`).inputs.spec.ports.find((p: any) => p.name === "metrics");
                const sidecar = deployment(resources, name).inputs.spec.template.spec.containers[1];
                assert.strictEqual(metricsPort.targetPort, sidecar.ports[0].containerPort, name);
            }
        });

        it("frontend Service is ClusterIP on minikube, as upstream", () =>
            assert.strictEqual(service(resources, "frontend").inputs.spec.type, "ClusterIP"));

        it("installs pinned kps and blackbox releases into monitoring", () => {
            const releases = ofType(resources, "kubernetes:helm.sh/v3:Release");
            const byName = Object.fromEntries(releases.map(r => [r.inputs.name, r.inputs]));
            assert.strictEqual(byName.kps.version, versions.kpsChart);
            assert.strictEqual(byName.blackbox.version, versions.blackboxChart);
            assert.strictEqual(byName.kps.namespace, "monitoring");
            assert.strictEqual(byName.kps.values.grafana.service.type, "NodePort");
        });

        it("creates the Probe, PrometheusRule and dashboard ConfigMap", () => {
            assert.strictEqual(customResources(resources, "Probe").length, 1);
            assert.strictEqual(customResources(resources, "PrometheusRule").length, 1);
            const cm = ofType(resources, "kubernetes:core/v1:ConfigMap").find(r => r.inputs.metadata.name === "guestbook-dashboards")!;
            assert.deepStrictEqual(cm.inputs.metadata.labels, { grafana_dashboard: "1" });
            assert.strictEqual(JSON.parse(cm.inputs.data["guestbook-overview.json"]).uid, "guestbook-overview");
        });

        it("outputs minikube access details", async () => {
            assert.strictEqual(outputs.grafanaAccessCommand, "minikube service kps-grafana -n monitoring --url");
            assert.strictEqual(await resolve(outputs.grafanaUrl), "run: minikube service kps-grafana -n monitoring --url");
            assert.strictEqual(outputs.grafanaAdminUser, "admin");
            assert.match(await resolve(outputs.frontendUrl), /port-forward svc\/frontend/);
            assert.strictEqual(outputs.prometheusAccessCommand, "kubectl -n monitoring port-forward svc/kps-prometheus 9090");
        });

        it("exports the Grafana password as a secret", async () => {
            assert.strictEqual(await resolve(outputs.grafanaAdminPassword), "mock-password-123");
            assert.strictEqual(await (outputs.grafanaAdminPassword as any).isSecret, true);
        });
    });

    describe("cloud", () => {
        let resources: Registered[];
        let outputs: StackOutputs;
        before(async () => ({ resources, outputs } = await run(parseConfig({}))));

        it("exposes the frontend through a LoadBalancer", () =>
            assert.strictEqual(service(resources, "frontend").inputs.spec.type, "LoadBalancer"));

        it("never exposes exporter metrics through a LoadBalancer", () => {
            for (const svc of ofType(resources, "kubernetes:core/v1:Service").filter(r => r.inputs.spec)) {
                if (svc.inputs.spec.type === "LoadBalancer") {
                    assert.ok(!svc.inputs.spec.ports.some((p: any) => p.name === "metrics"), svc.inputs.metadata.name);
                }
            }
            for (const name of ["frontend", "redis-leader", "redis-replica"]) {
                assert.strictEqual(service(resources, `${name}-metrics`).inputs.spec.type, "ClusterIP", name);
            }
        });

        it("outputs LoadBalancer URLs for Grafana and the frontend", async () => {
            assert.strictEqual(await resolve(outputs.grafanaUrl), `http://${LB_IP}`);
            assert.strictEqual(await resolve(outputs.frontendUrl), `http://${LB_IP}`);
        });

        it("Grafana is a LoadBalancer", () => {
            const kps = ofType(resources, "kubernetes:helm.sh/v3:Release").find(r => r.inputs.name === "kps")!;
            assert.strictEqual(kps.inputs.values.grafana.service.type, "LoadBalancer");
        });
    });

    describe("loadgen disabled", () => {
        it("does not deploy the load generator", async () => {
            const { resources } = await run(parseConfig({ isMinikube: true, loadgenEnabled: false }));
            assert.strictEqual(deployment(resources, "loadgen"), undefined);
            assert.ok(deployment(resources, "frontend"));
        });
    });
});
