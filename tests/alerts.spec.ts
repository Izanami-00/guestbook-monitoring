import * as assert from "assert";
import { guestbookRuleGroups } from "../src/alerts";
import { FRONTEND_PROBE_JOB, SCRAPE_TARGETS } from "../src/scrape";

describe("guestbook alerts", () => {
    const groups = guestbookRuleGroups();
    const rules = groups.flatMap(g => g.rules);

    it("has a single guestbook.rules group", () =>
        assert.deepStrictEqual(groups.map(g => g.name), ["guestbook.rules"]));

    it("defines exactly the planned alerts", () => assert.deepStrictEqual(rules.map(r => r.alert), [
        "GuestbookFrontendScrapeDown",
        "GuestbookFrontendProbeFailing",
        "GuestbookFrontendProbeSlow",
        "GuestbookRedisDown",
        "GuestbookRedisReplicationBroken",
        "GuestbookPodCrashLooping",
        "GuestbookContainerMemoryHigh",
        "GuestbookCPUThrottling",
    ]));

    it("every rule has severity, summary and description only", () => {
        for (const r of rules) {
            assert.ok(["critical", "warning"].includes(r.labels.severity), r.alert);
            assert.ok(r.annotations.summary.length > 0, r.alert);
            assert.ok(r.annotations.description.length > 0, r.alert);
            assert.deepStrictEqual(Object.keys(r.annotations).sort(), ["description", "summary"], r.alert);
        }
    });

    it("every expression is scoped to the guestbook namespace or a guestbook job", () => {
        const jobs = [...SCRAPE_TARGETS, FRONTEND_PROBE_JOB];
        for (const r of rules) {
            const scoped = r.expr.includes('namespace="guestbook"') || jobs.some(j => r.expr.includes(`job="${j}"`));
            assert.ok(scoped, r.alert);
        }
    });

    it("pages only on user-facing or data-path outages", () => assert.deepStrictEqual(
        rules.filter(r => r.labels.severity === "critical").map(r => r.alert),
        ["GuestbookFrontendScrapeDown", "GuestbookFrontendProbeFailing", "GuestbookRedisDown"]));

    it("uses the planned expressions and durations", () => {
        const byName = Object.fromEntries(rules.map(r => [r.alert, r]));
        assert.strictEqual(byName.GuestbookFrontendScrapeDown.expr, 'up{job="frontend"} == 0');
        assert.strictEqual(byName.GuestbookFrontendScrapeDown.for, "2m");
        assert.strictEqual(byName.GuestbookRedisReplicationBroken.expr, 'redis_connected_slaves{job="redis-leader"} < 1');
        assert.strictEqual(byName.GuestbookRedisReplicationBroken.for, "5m");
        assert.strictEqual(byName.GuestbookPodCrashLooping.for, "0m");
    });

    it("throttling alert also requires real throttled time, so bursty low-limit containers don't false-fire", () => {
        const expr = rules.find(r => r.alert === "GuestbookCPUThrottling")!.expr;
        assert.ok(expr.includes("container_cpu_cfs_throttled_seconds_total"), expr);
        assert.ok(expr.includes(" and "), expr);
    });
});
