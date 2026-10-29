import * as assert from "assert";
import { parseConfig } from "../src/config";
import { grafanaAccess, kpsValues } from "../src/monitoring";

describe("monitoring stack values", () => {
    const mk = parseConfig({ isMinikube: true });
    const cloud = parseConfig({});

    it("selects CRs regardless of helm labels", () => {
        const p = kpsValues(cloud, "x").prometheus.prometheusSpec;
        for (const k of ["serviceMonitor", "podMonitor", "probe", "rule"]) {
            assert.strictEqual(p[`${k}SelectorNilUsesHelmValues`], false, k);
        }
    });

    it("grafana NodePort 30300 on minikube", () => {
        const s = kpsValues(mk, "x").grafana.service;
        assert.deepStrictEqual([s.type, s.nodePort], ["NodePort", 30300]);
    });

    it("grafana LoadBalancer on cloud", () =>
        assert.strictEqual(kpsValues(cloud, "x").grafana.service.type, "LoadBalancer"));

    it("disables unscrapeable control plane on minikube", () => {
        const v = kpsValues(mk, "x");
        for (const k of ["kubeEtcd", "kubeScheduler", "kubeControllerManager", "kubeProxy"]) {
            assert.strictEqual(v[k].enabled, false, k);
        }
    });

    it("keeps control plane monitoring on cloud", () => {
        const v = kpsValues(cloud, "x");
        for (const k of ["kubeEtcd", "kubeScheduler", "kubeControllerManager", "kubeProxy"]) {
            assert.notStrictEqual(v[k]?.enabled, false, k);
        }
    });

    it("dashboard sidecar watches all namespaces with label grafana_dashboard", () => {
        const d = kpsValues(cloud, "x").grafana.sidecar.dashboards;
        assert.deepStrictEqual([d.enabled, d.label, d.labelValue, d.searchNamespace], [true, "grafana_dashboard", "1", "ALL"]);
    });

    it("uses supplied admin password and admin user", () => {
        const g = kpsValues(cloud, "pw").grafana;
        assert.deepStrictEqual([g.adminUser, g.adminPassword], ["admin", "pw"]);
    });

    it("gives Grafana enough memory for startup migrations", () =>
        assert.strictEqual(kpsValues(cloud, "x").grafana.resources.limits.memory, "512Mi"));

    it("skips node-exporter's host root mount on minikube (fails on nested Docker mounts)", () => {
        assert.strictEqual(kpsValues(mk, "x")["prometheus-node-exporter"].hostRootFsMount.enabled, false);
        assert.strictEqual(kpsValues(cloud, "x")["prometheus-node-exporter"], undefined);
    });

    it("names resources with the kps prefix", () => assert.strictEqual(kpsValues(cloud, "x").fullnameOverride, "kps"));

    it("minikube access command", () =>
        assert.strictEqual(grafanaAccess(mk).accessCommand, "minikube service kps-grafana -n monitoring --url"));

    it("minikube static URL only when minikubeIp is known", () => {
        assert.strictEqual(grafanaAccess(mk).staticUrl, undefined);
        assert.strictEqual(grafanaAccess(parseConfig({ isMinikube: true, minikubeIp: "192.168.49.2" })).staticUrl,
            "http://192.168.49.2:30300");
    });
});
