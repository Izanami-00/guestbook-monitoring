import * as assert from "assert";
import { frontendProbeSpec, SCRAPE_TARGETS, serviceMonitorSpec } from "../src/scrape";

describe("scrape configuration", () => {
    it("ServiceMonitor targets metrics port in guestbook ns", () => {
        const s: any = serviceMonitorSpec("redis-leader");
        assert.deepStrictEqual(s.selector, { matchLabels: { app: "redis-leader", "guestbook/metrics": "true" } });
        assert.strictEqual(s.jobLabel, "app");
        assert.deepStrictEqual(s.namespaceSelector, { matchNames: ["guestbook"] });
        assert.deepStrictEqual(s.endpoints, [{ port: "metrics", interval: "15s" }]);
    });

    it("scrapes frontend and both redis services", () =>
        assert.deepStrictEqual(SCRAPE_TARGETS, ["frontend", "redis-leader", "redis-replica"]));

    it("Probe hits frontend via blackbox http_2xx", () => {
        const p: any = frontendProbeSpec();
        assert.strictEqual(p.jobName, "frontend-probe");
        assert.strictEqual(p.module, "http_2xx");
        assert.strictEqual(p.interval, "15s");
        assert.strictEqual(p.prober.url, "blackbox-prometheus-blackbox-exporter.monitoring.svc:9115");
        assert.deepStrictEqual(p.targets.staticConfig.static, ["http://frontend.guestbook.svc.cluster.local"]);
    });
});
