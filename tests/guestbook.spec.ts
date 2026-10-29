import * as assert from "assert";
import { apacheExporterSidecar, redisExporterSidecar } from "../src/guestbook";

describe("guestbook exporter sidecars", () => {
    it("apache sidecar scrapes local mod_status", () => {
        const c = apacheExporterSidecar();
        assert.ok((c.args as string[]).includes("--scrape_uri=http://localhost/server-status?auto"));
        assert.deepStrictEqual(c.ports, [{ name: "metrics", containerPort: 9117 }]);
    });

    it("redis sidecar targets localhost", () =>
        assert.deepStrictEqual(redisExporterSidecar().env, [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }]));

    it("redis sidecar exposes metrics port 9121", () =>
        assert.deepStrictEqual(redisExporterSidecar().ports, [{ name: "metrics", containerPort: 9121 }]));

    it("sidecars have requests and limits", () => {
        for (const c of [apacheExporterSidecar(), redisExporterSidecar()]) {
            assert.ok(c.resources && (c.resources as any).requests && (c.resources as any).limits, String(c.name));
        }
    });

    it("sidecar images are pinned", () => {
        for (const c of [apacheExporterSidecar(), redisExporterSidecar()]) {
            assert.doesNotMatch(String(c.image), /:latest$|^[^:@]+$/);
        }
    });
});
