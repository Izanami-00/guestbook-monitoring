import * as assert from "assert";
import * as path from "path";
import { DASHBOARD_EXPRESSIONS, dashboardConfigMapData, loadDashboard } from "../src/dashboards";

describe("Guestbook Overview dashboard", () => {
    const dashboard = loadDashboard(path.join(__dirname, "..", "dashboards", "guestbook-overview.json"));
    const panels: any[] = dashboard.panels.filter((p: any) => p.type !== "row");
    const targets: any[] = panels.flatMap(p => p.targets);

    it("has a stable uid and title", () =>
        assert.deepStrictEqual([dashboard.uid, dashboard.title], ["guestbook-overview", "Guestbook Overview"]));

    it("has three rows and twelve panels", () => {
        assert.deepStrictEqual(dashboard.panels.filter((p: any) => p.type === "row").map((p: any) => p.title),
            ["Frontend (RED)", "Redis", "Pods (USE)"]);
        assert.strictEqual(panels.length, 12);
    });

    it("every query uses the datasource template variable", () => {
        for (const t of targets) {
            assert.deepStrictEqual(t.datasource, { type: "prometheus", uid: "${datasource}" });
        }
        for (const p of panels) {
            assert.deepStrictEqual(p.datasource, { type: "prometheus", uid: "${datasource}" }, p.title);
        }
    });

    it("defines the datasource variable defaulting to Prometheus", () => {
        const v = dashboard.templating.list.find((x: any) => x.name === "datasource");
        assert.strictEqual(v.type, "datasource");
        assert.strictEqual(v.query, "prometheus");
    });

    it("contains every planned query verbatim", () => {
        const exprs = targets.map(t => t.expr);
        assert.strictEqual(DASHBOARD_EXPRESSIONS.length, 12);
        for (const e of DASHBOARD_EXPRESSIONS) {
            assert.ok(exprs.includes(e), e);
        }
    });

    it("has unique panel ids and non-overlapping grid rows", () => {
        const ids = dashboard.panels.map((p: any) => p.id);
        assert.strictEqual(new Set(ids).size, ids.length);
        const cells = new Set<string>();
        for (const p of dashboard.panels) {
            for (let x = p.gridPos.x; x < p.gridPos.x + p.gridPos.w; x++) {
                for (let y = p.gridPos.y; y < p.gridPos.y + p.gridPos.h; y++) {
                    const key = `${x},${y}`;
                    assert.ok(!cells.has(key), `overlap at ${key} (${p.title})`);
                    cells.add(key);
                }
            }
            assert.ok(p.gridPos.x + p.gridPos.w <= 24, p.title);
        }
    });

    it("ConfigMap data is keyed by file name", () =>
        assert.deepStrictEqual(Object.keys(dashboardConfigMapData()), ["guestbook-overview.json"]));
});
