import * as assert from "assert";
import { parseConfig } from "../src/config";
import { loadgenContainer, shouldDeployLoadgen } from "../src/loadgen";
import { versions } from "../src/versions";

describe("load generator", () => {
    const c = loadgenContainer();
    const script = (c.args as string[]).join(" ");

    it("uses the pinned curl image", () => assert.strictEqual(c.image, versions.loadgenImage));

    it("reads the page and guestbook entries", () => {
        assert.ok(script.includes("http://frontend/"), script);
        assert.ok(script.includes("http://frontend/guestbook.php?cmd=get&key=messages"), script);
    });

    it("writes to its own key so human guestbook entries are never overwritten", () => {
        assert.ok(script.includes("http://frontend/guestbook.php?cmd=set&key=loadgen"), script);
        assert.ok(!script.includes("cmd=set&key=messages"), script);
    });

    it("has requests and limits", () => {
        const r: any = c.resources;
        assert.ok(r.requests && r.limits);
    });

    it("has enough CPU headroom to fork curl without constant CFS throttling", () =>
        assert.strictEqual((c.resources as any).limits.cpu, "200m"));

    it("is deployed by default and can be turned off", () => {
        assert.strictEqual(shouldDeployLoadgen(parseConfig({})), true);
        assert.strictEqual(shouldDeployLoadgen(parseConfig({ loadgenEnabled: false })), false);
    });
});
